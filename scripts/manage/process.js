// 平台进程管理（管理台规格 §4.2）：平台是工作台的子进程，关窗即停；不做后台守护、不 kill 他人进程
//   （M2：本项目自己之前没关掉的平台不算他人进程，教师点"停止它并启动"时可结束，见 port-owner.js 与规格 §7.3）
//   createPlatform({ root, serverCommand?, buildCommand?, env?, log?, readyTimeoutMs?, stopTimeoutMs?, portOwner?, stopOwn? })
//     → { status(), start({ forceBuild, stopOld }), stop(), restart(), rebuild(), killNow(), tail(n), on(event, fn), off(event, fn) }
//     serverCommand 缺省用 kernel/server/index.js 的绝对路径（Windows 上据此认出本项目的平台进程）
//     portOwner(port) → { pid, name, ours } | null；stopOwn(port, pid) → { ok, message? }（缺省为 port-owner.js 的实现，测试可注入）
//     状态 stopped | building | starting | running | stopping；事件 'state'（status 对象）、'log' / 'build'（一行文本）
//   启动顺序：读 .env（密码为空即失败）→ requires 检查（只提醒，G4）→ 端口探测 → 需要时构建 → spawn 平台 → 轮询 GET /api/roster ≤ 15 s
//   日志：stdout / stderr 写 data/logs/server.log（> 5 MB 改名为 .1 保留一份）并进内存环形缓冲（500 行）
//   explainFailure(lines, port) / describeExit(code, signal) / portBusyError(port, owner, suggestPort)：纯函数，给教师看的一句话原因
//   failMessage(kind, { what, seconds })：M3 审查，端口以外各类失败的一句话（不含原始报错、退出码、"构建"；原始信息只进 detail）
//   G3：LESSON_CONFIG 空值（还没有课程）→ error = { kind: 'no-lesson', message: '还没有课程，先新建一门' }，不启动
//   status().lessonConfig：M3 审查，平台启动时的 LESSON_CONFIG（上课面板显示正在跑的课）
//   status().dbPath：M6 审查，平台启动时实际用的库（绝对路径；启动前算好、以 DB_PATH 传给子进程：.env 自定义 DB_PATH，否则 data/lessons/<课程 id>.sqlite）；
//     工作台据它判断名单 / 数据页选中的课是不是"正在跑"（比较库路径）
//   端口被占时 error = { kind: 'port', reason: 'in-use', port, owner, suggestPort, message }；
//     reason 'no-permission'（需要管理员权限）/ 'not-ours'（stopOld 指向的不是本项目平台；同样带 suggestPort）
//   运行中意外退出：error = { kind: 'crash', phase: 'running', message, detail }
//   checkRequires(root, lessonRel) → { needed, missing, components }：复用 component-loader 的 loadComponents
//   L1：启动顺序：读课程 → 课程校验 → requires 检查（组件写错先由校验逐条报出）；课程校验（checkLesson(root, lessonRel)，缺省 check:lesson 跑在 worker 线程里）：
//     V1（代码题测试验证规格 §5.5）：只有课程加载不了（rule 'loader' 的错误）→ error = { kind: 'check', message: '课程文件加载不了…', detail: 每条一行, check }，
//     不构建不启动；其它错误与警告照常构建启动（任何检查结果都不拦上课），页面状态带显示"课程有 N 处问题、M 处提醒，已照常启动"；
//     status().check = 最近一次启动时的检查结果 { ok, errors, warnings, path, at, tests }
//   G4（工作台课程与平台两区重构规格 §3.2）：课程需要的环境缺（requires 的文件不在）不再拦启动（原 error.kind 'requires' 删除），
//     照常构建启动，status().envWarning = ENV_WARNING（一句提醒）；环境齐了或没有要求时 null；每次启动重新算
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { loadComponents, lessonComponentsRootOf } from '../../kernel/server/component-loader.js';
import { effectiveEnv, platformEnv } from './env-file.js';
import { readLesson } from './lessons.js';
import { lessonDbPath } from '../../kernel/server/lesson-db-path.js';
import { needsBuild, build, pipeLines } from './build.js';
import { probePort, suggestPort } from './net.js';
import { findPortOwner, stopOwnPlatform } from './port-owner.js';
import { checkLessonInWorker } from '../lib/check-in-worker.js';
import { formatItem } from '../check-lesson.mjs';

const RING_LINES = 500;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function explainFailure(lines, port) {
  const text = (lines || []).join('\n');
  if (/EADDRINUSE/.test(text)) return `端口 ${port} 已被别的程序占用，换一个端口或关掉那个程序`;
  if (/EACCES/.test(text)) return `端口 ${port} 需要管理员权限，请改用 3001 或 8080`;
  if (/TEACHER_PASSWORD/.test(text)) return '请先在设置里填写教师密码';
  return null;
}

// 端口被占的三种提示（M2 Task 2）：本项目旧平台 / 别的程序（查得到名字）/ 查不出来
export function portBusyError(port, owner, suggest) {
  const base = { kind: 'port', reason: 'in-use', port, owner: owner ?? null, suggestPort: suggest ?? null };
  if (owner?.ours) return { ...base, message: `端口 ${port} 上有一个之前没关掉的平台（进程 ${owner.pid}）` };
  if (owner?.name) {
    return {
      ...base,
      message: suggest
        ? `端口 ${port} 被「${owner.name}」占用，可以改用 ${suggest}，或关掉那个程序后重试`
        : `端口 ${port} 被「${owner.name}」占用，请关掉那个程序后重试，或在设置里换一个端口`,
    };
  }
  return { ...base, message: explainFailure(['EADDRINUSE'], port) };
}

// S12：失败提示默认只说"查看详情"；工作台写成排障文件后用 withDiagHint 换成"复制给 AI"（server.js 的状态里换，文件没写成就不换）
export const SEND_LOG = '点"查看详情"看出错记录';
export const DIAG_HINT = '点"复制给 AI"把排障文件贴给 AI 工具';
export const withDiagHint = (msg) => (typeof msg === 'string' ? msg.replace(SEND_LOG, DIAG_HINT) : msg);
const WHAT = { 构建: '准备页面', 启动: '启动', 重启: '重启' };

// G4 §3.2：启动时环境还没准备好的提醒（现在只有 Python 环境一种）
export const ENV_WARNING = 'Python 环境还没准备好，写程序的段上课时用不了；准备好后重启平台生效';

export function failMessage(kind, { what, seconds, count } = {}) {
  switch (kind) {
    case 'no-lesson': return '还没有课程，先新建一门';
    case 'password': return '请先在设置里填写教师密码';
    case 'lesson': return '这门课程的文件有错，读不出来；请让帮你生成课程的 AI 检查后再试，或换一门课';
    case 'check': return `课程文件加载不了，平台起不来：有 ${count} 处要改；点"查看详情"看是哪几处，可以"复制给 AI"让它照着改`;
    case 'build': return `页面没能准备好，${SEND_LOG}`;
    case 'crash': return `平台没能启动，${SEND_LOG}`;
    case 'timeout': return `平台 ${seconds} 秒内没有启动完成，已停止；${SEND_LOG}`;
    case 'internal': return `${WHAT[what] ?? '操作'}时出了问题，${SEND_LOG}`;
    default: return `出了问题，${SEND_LOG}`;
  }
}

// 运行中意外退出的一句话；退出码只进详情（见 exitDetail）
export function describeExit(code, signal) {
  if (code !== null && code !== undefined) return `平台意外停止了，${SEND_LOG}`;
  return signal ? '平台被系统结束了' : '平台意外停止了';
}
const exitDetail = (code, signal) => (code !== null && code !== undefined ? `（退出码 ${code}）` : signal ? `（信号 ${signal}）` : null);

export function createLogWriter(file, maxBytes = LOG_MAX_BYTES) {
  let size = null;
  function ensure() {
    if (size !== null) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      size = fs.statSync(file).size;
    } catch {
      size = 0;
    }
  }
  return {
    file,
    write(line) {
      try {
        ensure();
        const text = `${line}\n`;
        const bytes = Buffer.byteLength(text);
        if (size > 0 && size + bytes > maxBytes) {
          fs.renameSync(file, `${file}.1`);
          size = 0;
        }
        fs.appendFileSync(file, text);
        size += bytes;
      } catch {
        // 写日志失败不影响平台运行
      }
    },
  };
}

export async function checkRequires(root, lessonRel) {
  const lesson = await readLesson(root, lessonRel);
  if (!lesson) throw new Error(`找不到课程配置 ${lessonRel}`);
  const components = await loadComponents(lesson.config, path.join(root, 'components'), {
    lessonComponentsRoot: lessonComponentsRootOf(path.resolve(root, lessonRel)),
  });
  const missing = [];
  let needed = false;
  for (const c of components) {
    for (const r of c.requires) {
      needed = true;
      if (!fs.existsSync(path.resolve(root, r.path))) missing.push({ id: c.id, label: c.label, path: r.path, hint: r.hint });
    }
  }
  return { needed, missing, components };
}

async function ping(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/roster`, { signal: AbortSignal.timeout(1000) });
    await res.arrayBuffer().catch(() => {});
    return res.status === 200;
  } catch {
    return false;
  }
}

export function createPlatform({
  root,
  serverCommand = [process.execPath, path.join(root, 'kernel', 'server', 'index.js')],
  buildCommand,
  env: extraEnv = {},
  log = (m) => console.log(m),
  readyTimeoutMs = 15000,
  stopTimeoutMs = 5000,
  logFile = path.join(root, 'data', 'logs', 'server.log'),
  portOwner = (port) => findPortOwner(port, { root }),
  stopOwn = (port, pid) => stopOwnPlatform(port, pid, { root }),
  // 组件目录与 checkRequires 一致：<项目根>/components
  checkLesson = (projectRoot, rel) => checkLessonInWorker(rel, { root: projectRoot, componentsRoot: path.join(projectRoot, 'components') }),
}) {
  const ee = new EventEmitter();
  const ring = [];
  const writer = createLogWriter(logFile);
  const st = { state: 'stopped', port: null, startedAt: null, lesson: null, lessonConfig: null, dbPath: null, error: null, lastExit: null, check: null, envWarning: null };
  let child = null;
  let buildChild = null;
  let op = null; // 进行中的 start / rebuild
  let stopping = null;
  let abort = false;
  let startedEnv = null;

  const status = () => ({ ...st });
  const set = (patch) => {
    Object.assign(st, patch);
    ee.emit('state', status());
  };
  const addLine = (kind, text) => {
    ring.push(text);
    if (ring.length > RING_LINES) ring.shift();
    writer.write(text);
    ee.emit(kind, text);
  };
  const tail = (n = 50) => ring.slice(-Math.max(0, Math.min(n, RING_LINES)));

  async function runBuild(lessonConfig) {
    set({ state: 'building' });
    writer.write(`==== 构建 ${new Date().toISOString()} ${lessonConfig}`);
    const r = await build(root, lessonConfig, (l) => addLine('build', l), {
      command: buildCommand,
      onSpawn: (c) => { buildChild = c; },
    });
    buildChild = null;
    return r;
  }

  function waitClose(c) {
    if (!c || c.exitCode !== null || c.signalCode !== null) return Promise.resolve();
    return c._closed;
  }

  async function killChild(c) {
    if (!c) return;
    c.kill('SIGTERM');
    const exited = await Promise.race([waitClose(c).then(() => true), sleep(stopTimeoutMs).then(() => false)]);
    if (!exited) {
      c.kill('SIGKILL');
      await Promise.race([waitClose(c), sleep(2000)]);
    }
  }

  async function doStart(forceBuild, stopOld) {
    set({ state: 'starting', error: null, port: null, startedAt: null, envWarning: null });
    const fail = (error) => {
      if (abort) return { ok: false, error: null };
      set({ state: 'stopped', error, port: null, startedAt: null });
      log(`[manage] 启动失败：${error.message}`);
      return { ok: false, error };
    };
    const fileEnv = effectiveEnv(root);
    const port = Number(fileEnv.PORT);
    // G3（管理台线性路径重设计规格 §2.4）：还没有课程（LESSON_CONFIG 空值）→ 不启动；线性路径第一步是新建课程，先于密码检查
    if (!fileEnv.LESSON_CONFIG) return fail({ kind: 'no-lesson', message: failMessage('no-lesson') });
    if (!fileEnv.TEACHER_PASSWORD) return fail({ kind: 'password', message: failMessage('password') });
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return fail({ kind: 'port', message: `端口 ${fileEnv.PORT} 不对，请在设置里改成 1 到 65535 之间的整数` });
    }
    let lessonTitle = null;
    let dbPath = null;
    try {
      const lesson = await readLesson(root, fileEnv.LESSON_CONFIG);
      if (!lesson) throw new Error(`找不到课程配置 ${fileEnv.LESSON_CONFIG}`);
      lessonTitle = lesson.title ?? null;
      // M6 审查：这次启动用的库（课程 id 不合法时 lessonDbPath 抛错 → 按课程读不出处理）
      const explicit = extraEnv.DB_PATH ?? fileEnv.DB_PATH;
      dbPath = explicit ? path.resolve(root, explicit) : lessonDbPath(root, lesson.id);
    } catch (err) {
      return fail({ kind: 'lesson', message: failMessage('lesson'), detail: [String(err?.message ?? err)] });
    }
    // L1：构建之前先校验课程（check:lesson，worker 线程里跑，读到的是课程文件的最新内容）；V1：只有加载不了才不构建、不启动。
    // 校验器自身出错时只记日志、照常启动（不因检查工具的问题挡住上课）
    let check = null;
    try {
      check = { ...(await checkLesson(root, fileEnv.LESSON_CONFIG)), path: fileEnv.LESSON_CONFIG, at: Date.now() };
    } catch (err) {
      log(`[manage] 课程检查没能完成，跳过：${err?.message ?? err}`);
    }
    if (abort) return { ok: false, error: null };
    st.check = check; // 不单独发状态事件，随下一次 set 一起发出
    const checkFail = (count) => fail({
      kind: 'check',
      message: failMessage('check', { count }),
      detail: check.errors.map(formatItem),
      check,
    });
    const loaderErrors = check ? check.errors.filter((e) => e.rule === 'loader') : [];
    if (loaderErrors.length > 0) return checkFail(loaderErrors.length);
    // 组件写错（不存在的组件等）平台同样起不来：检查已逐条报出时按"加载不了"列出；检查器自身失败时仍按"读不出来"处理
    let req;
    try {
      req = await checkRequires(root, fileEnv.LESSON_CONFIG);
    } catch (err) {
      if (check && check.errors.length > 0) return checkFail(check.errors.length);
      return fail({ kind: 'lesson', message: failMessage('lesson'), detail: [String(err?.message ?? err)] });
    }
    // G4：环境缺只提醒，不拦启动（随下一次状态事件一起发出）
    if (req.missing.length) {
      st.envWarning = ENV_WARNING;
      log(`[manage] 课程需要的环境还没准备好，照常启动：${req.missing.map((m) => m.path).join('、')}`);
    }
    if (stopOld) {
      // "停止它并启动"：只结束此刻占着端口、且判定为本项目平台的那个进程（port-owner.js 里再确认一次）
      const r = await stopOwn(port, stopOld);
      if (abort) return { ok: false, error: null };
      if (!r?.ok) {
        return fail({ kind: 'port', reason: 'not-ours', port, suggestPort: await suggestPort(port), message: r?.message ?? '没能结束之前的平台' });
      }
    }
    const probe = await probePort(port);
    if (probe === 'in-use') {
      const [owner, suggest] = await Promise.all([Promise.resolve(portOwner(port)).catch(() => null), suggestPort(port)]);
      return fail(portBusyError(port, owner, suggest));
    }
    if (probe === 'no-permission') {
      return fail({ kind: 'port', reason: 'no-permission', port, suggestPort: await suggestPort(port), message: explainFailure(['EACCES'], port) });
    }
    if (abort) return { ok: false, error: null };

    if (forceBuild || needsBuild(root, fileEnv.LESSON_CONFIG)) {
      const r = await runBuild(fileEnv.LESSON_CONFIG);
      if (abort) return { ok: false, error: null };
      if (!r.ok) return fail({ kind: 'build', message: failMessage('build'), detail: r.lines.slice(-20) });
      set({ state: 'starting' });
    }

    const childEnv = { ...process.env, ...fileEnv, DB_PATH: dbPath, ...extraEnv };
    writer.write(`==== 启动 ${new Date().toISOString()} 端口 ${port}`);
    const c = spawn(serverCommand[0], serverCommand.slice(1), {
      cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    child = c;
    c._closed = new Promise((resolve) => c.once('close', resolve));
    const recent = [];
    const onLine = (l) => {
      recent.push(l);
      if (recent.length > 20) recent.shift();
      addLine('log', l);
    };
    pipeLines(c.stdout, onLine);
    pipeLines(c.stderr, onLine);
    let exited = false;
    c.once('error', (err) => onLine(`平台进程无法启动：${err.message}`));
    c._closed.then(() => {
      exited = true;
      const lines = [...recent];
      st.lastExit = { code: c.exitCode, signal: c.signalCode, at: Date.now(), lines };
      if (child === c) child = null;
      if (st.state === 'running') {
        set({
          state: 'stopped', port: null, startedAt: null,
          // phase: 'running'：运行中意外退出（页面显示"平台意外停止"，不是"没能启动"）
          error: {
            kind: 'crash', phase: 'running',
            message: explainFailure(lines, port) ?? describeExit(c.exitCode, c.signalCode),
            detail: [...lines, exitDetail(c.exitCode, c.signalCode)].filter(Boolean),
          },
        });
      }
    });

    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (abort) return { ok: false, error: null };
      if (exited) {
        const lines = st.lastExit?.lines ?? [];
        const detail = [...lines, exitDetail(st.lastExit?.code, st.lastExit?.signal)].filter(Boolean);
        return fail({ kind: 'crash', message: explainFailure(lines, port) ?? failMessage('crash'), detail });
      }
      if (await ping(port)) break;
      if (Date.now() > deadline) {
        await killChild(c);
        return fail({
          kind: 'timeout',
          message: failMessage('timeout', { seconds: Math.round(readyTimeoutMs / 1000) }),
          detail: [...recent],
        });
      }
      await sleep(250);
    }
    if (abort) return { ok: false, error: null };
    startedEnv = JSON.stringify(platformEnv(root));
    set({ state: 'running', port, startedAt: Date.now(), lesson: lessonTitle, lessonConfig: fileEnv.LESSON_CONFIG, dbPath });
    log(`[manage] 平台已启动，端口 ${port}`);
    return { ok: true };
  }

  // 启动 / 构建流程里的意外异常：结束可能已拉起的子进程，回到 stopped 并给出原因（不让 Promise 拒绝）
  async function internalFail(err, what) {
    log(`[manage] ${what}出错：${err?.stack ?? err}`);
    buildChild?.kill();
    await killChild(child).catch(() => {});
    const error = { kind: 'internal', message: failMessage('internal', { what }), detail: [String(err?.message ?? err)] };
    set({ state: 'stopped', port: null, startedAt: null, error });
    return { ok: false, error };
  }

  function start({ forceBuild = false, stopOld = null } = {}) {
    if (st.state !== 'stopped') return Promise.resolve({ ok: false, error: { kind: 'busy', message: '平台已在运行或正在启动' } });
    abort = false;
    op = doStart(forceBuild, stopOld)
      .catch((err) => (abort ? { ok: false, error: null } : internalFail(err, '启动')))
      .finally(() => { op = null; });
    return op;
  }

  function rebuild() {
    if (st.state !== 'stopped') return Promise.resolve({ ok: false, error: { kind: 'busy', message: '请先停止平台再重新构建' } });
    abort = false;
    op = (async () => {
      set({ error: null });
      const lessonConfig = effectiveEnv(root).LESSON_CONFIG;
      if (!lessonConfig) {
        const error = { kind: 'no-lesson', message: failMessage('no-lesson') };
        set({ state: 'stopped', error });
        return { ok: false, error };
      }
      const r = await runBuild(lessonConfig);
      if (abort) return { ok: false, error: null };
      const error = r.ok ? null : { kind: 'build', message: failMessage('build'), detail: r.lines.slice(-20) };
      set({ state: 'stopped', error });
      return { ok: r.ok, error };
    })()
      .catch((err) => (abort ? { ok: false, error: null } : internalFail(err, '构建')))
      .finally(() => { op = null; });
    return op;
  }

  // 同步结束子进程（工作台进程退出时用，不等待）：平台收到 SIGTERM 会自行关库退出
  function killNow() {
    try {
      buildChild?.kill();
    } catch {
      // ignore
    }
    try {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  function stop() {
    if (stopping) return stopping;
    if (st.state === 'stopped') return Promise.resolve({ ok: true });
    stopping = (async () => {
      abort = true;
      const port = st.port ?? Number(effectiveEnv(root).PORT);
      set({ state: 'stopping' });
      buildChild?.kill();
      await killChild(child);
      if (op) await op.catch(() => {});
      await killChild(child); // start 流程在等待期间可能刚好拉起了进程
      if (Number.isInteger(port) && port > 0) {
        const end = Date.now() + 5000;
        while (Date.now() < end && (await probePort(port)) === 'in-use') await sleep(200);
      }
      startedEnv = null;
      set({ state: 'stopped', port: null, startedAt: null, error: null });
      log('[manage] 平台已停止');
      return { ok: true };
    })().finally(() => { stopping = null; });
    return stopping;
  }

  async function restart() {
    try {
      await stop();
    } catch (err) {
      return internalFail(err, '重启');
    }
    return start();
  }

  // 运行中且 .env 与启动时不同 → 有改动未生效
  function pendingRestart() {
    if (!startedEnv || st.state !== 'running') return false;
    return JSON.stringify(platformEnv(root)) !== startedEnv; // 只影响下载的键（DOWNLOAD_KEYS）不算
  }

  return {
    status,
    start,
    stop,
    restart,
    rebuild,
    killNow,
    tail,
    pendingRestart,
    logFile,
    on: (ev, fn) => ee.on(ev, fn),
    off: (ev, fn) => ee.off(ev, fn),
    _child: () => child,
  };
}

// ===== 工作台单实例锁 =====
// 项目根的 .manage.lock（JSON：{ pid, port, url, startedAt }，权限 600）：同一项目根只允许一个工作台，
// 否则第二个工作台看不到第一个拉起的平台，会对运行中的库做离线操作。
//   acquireManageLock(root, { pid?, isAlive?, probe? }) → { ok: true, update(info), release() } | { ok: false, other }
//   已有锁：持有进程已不在，或记录的工作台端口已无人监听（进程号被别的程序复用）→ 视为残留，清理后重试；
//   持有进程还在但尚未写端口 → other.starting = true
export const LOCK_FILE = '.manage.lock';

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return err.code === 'ENOENT' ? undefined : null; // undefined：没有锁；null：锁文件损坏
  }
}

export async function acquireManageLock(root, { pid = process.pid, isAlive = pidAlive, probe = probePort } = {}) {
  const file = path.join(root, LOCK_FILE);
  for (let attempt = 0; attempt < 5; attempt++) {
    let fd;
    try {
      fd = fs.openSync(file, 'wx', 0o600);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const other = readLock(file);
      if (other === undefined) continue; // 刚被删掉，重试
      const alive = other && isAlive(other.pid);
      const stale = !alive || (other.port && (await probe(other.port, '127.0.0.1')) !== 'in-use');
      if (!stale) return { ok: false, other: { ...other, starting: !other.port } };
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // 下一轮再试
      }
      continue;
    }
    const startedAt = new Date().toISOString();
    try {
      fs.writeSync(fd, `${JSON.stringify({ pid, startedAt })}\n`);
    } finally {
      fs.closeSync(fd);
    }
    return {
      ok: true,
      file,
      update(info) {
        fs.writeFileSync(file, `${JSON.stringify({ pid, startedAt, ...info })}\n`, { mode: 0o600 });
      },
      // 只删自己的锁（同步，可在 process 'exit' 里调用）
      release() {
        try {
          if (readLock(file)?.pid === pid) fs.rmSync(file, { force: true });
        } catch {
          // ignore
        }
      },
    };
  }
  throw new Error(`无法获取 ${LOCK_FILE}`);
}

// ===== S6：npm run manage 遇旧工作台窗口时自动接管 =====
//   pingManage(port, { timeoutMs = 1000 }) → GET http://127.0.0.1:<port>/api/ping 的 JSON；连不上 / 超时 / 非 200 / 非 JSON → null
//   decideTakeover({ other, pingResult, root }) → 纯函数：
//     { action: 'replace', pid }：旧窗口已写端口、ping 回的是本项目工作台（app 相符、root 与本项目相同、pid 与锁里一致）且平台 stopped
//     { action: 'busy', state }：同上但 platformState 不是 stopped（running / starting / building / stopping；
//       'updating' = 正在更新平台或更新成功等重启；'busy' = 离线恢复 / 重置中或 Python 运行时下载中）→ 不接管
//   takeoverMessage(state) → busy 时给教师的一句话（按 state 区分）
//     { action: 'none', reason: 'starting' | 'no-ping' | 'not-ours' }：旧窗口正在启动 / ping 不通 / 不是本项目或 pid 对不上 → 不接管，提示不变
//   replaceOldManage({ pid, kill?, acquire, sleep?, timeoutMs = 10000, now? }) → 对 pid 发一次结束信号（Windows process.kill(pid)，
//     其它 SIGTERM），再每 200 ms 重取锁（acquire 抛错当作没取到），最多 timeoutMs；取到返回锁，超时返回 null。
//     只应以 decideTakeover 给出的 pid 调用
export const MANAGE_APP = 'eduplatform-manage';

export async function pingManage(port, { timeoutMs = 1000 } = {}) {
  if (!Number.isInteger(port) || port <= 0) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.status !== 200) return null;
    const body = await r.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function sameRoot(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

export function decideTakeover({ other, pingResult, root }) {
  if (!other || other.starting || !other.port) return { action: 'none', reason: 'starting' };
  if (!pingResult) return { action: 'none', reason: 'no-ping' };
  const ours = typeof pingResult === 'object' && !Array.isArray(pingResult)
    && pingResult.app === MANAGE_APP
    && sameRoot(pingResult.root, root)
    && Number.isInteger(other.pid) && other.pid > 0 && pingResult.pid === other.pid;
  if (!ours) return { action: 'none', reason: 'not-ours' };
  if (pingResult.platformState !== 'stopped') return { action: 'busy', state: pingResult.platformState ?? null };
  return { action: 'replace', pid: other.pid };
}

function killManage(pid) {
  if (process.platform === 'win32') process.kill(pid);
  else process.kill(pid, 'SIGTERM');
}

export async function replaceOldManage({
  pid, kill = killManage, acquire, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 10_000, now = Date.now,
}) {
  try {
    kill(pid);
  } catch {
    // 进程已不在（ESRCH）等：照常等锁，acquireManageLock 会清理残留锁
  }
  const deadline = now() + timeoutMs;
  for (;;) {
    let lock = null;
    try {
      lock = await acquire();
    } catch {
      lock = null; // 读写锁文件出错：当作没取到，下一轮再试
    }
    if (lock?.ok) return lock;
    if (now() >= deadline) return null;
    await sleep(200);
  }
}

export function takeoverMessage(state) {
  if (state === 'updating') return '那个窗口正在更新平台，等它完成后会自动重启，请用重启后的窗口。';
  if (state === 'busy') return '那个窗口正在恢复 / 重置数据或下载运行时，等它完成再试。';
  return '另一个工作台窗口正在上课，请用那个窗口；确实要换窗口，先在那边停止平台。';
}
