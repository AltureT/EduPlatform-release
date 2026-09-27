// 管理台 HTTP 服务（管理台规格 §4.7、§4.6）：只监听 127.0.0.1；/api/* 全部要求 X-Manage-Token
//   createManageServer({ root, token, port = 0, platform?, serverCommand?, buildCommand?, fetchCommand?, statfs?, log? })
//     → { app, platform, listen(port?) → Promise<url>, close(), killChildrenNow(), url }
//   url 形如 http://127.0.0.1:3900/?t=<token>；页面（public/ 与 /ui-logic.js）本身无需 token
//   M2：overview 增加 setup（引导条）、lesson.dev / stageCount、urls.qr（第一个学生地址的 SVG 二维码）；
//     POST /api/platform/start 可带 { stopOld: <进程号> }（"停止它并启动"，只对判定为本项目的旧平台生效）
//   M3：overview 增加 runningLesson（运行中平台启动时的课程，未运行 null）、lesson.missing（找不到，区别于写坏了读不出）、build.stale（运行中且课程源文件有更新，首页黄条"重启并应用"）；setup.lessonChosen 只看课程能否读出
//   EventSource 不能带自定义请求头，故 GET /api/events 另接受查询参数 t（只此一处）
//   L1：POST /api/lesson/check { path? } → { ok, errors, warnings, lesson, path, at }（check:lesson，worker 线程）；
//     overview.check = 当前课最近一次检查结果（本接口或启动前的检查，取较新的），没有则 null；checkLesson(root, rel) 可注入
//   M4：课程页接口 /api/lessons/overview、/templates、/template.{docx,md}、POST /api/lessons（新建）、
//     /api/lessons/:scope/:name/{current,draft,open,opening}、DELETE /api/lessons/:scope/:name（lesson-admin.js）；
//     openFolder(dir) 与 maxDraftBytes 可注入（测试用）
//   K7：GET /api/settings 多一项 platformFiles（框架自描述规格 §4）：{ checked, version, builtAt?, total?, changes?, modified?, missing?, added? }
//     ——版本.json 的 protected 清单与本机平台文件比对（三个数组各最多 PLATFORM_LIST_MAX 条）；没有 版本.json 时 checked: false、version 取 package.json
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { effectiveEnv, readEnv, writeEnv, settingsView, prepareSettingsPatch, validateSettings, downloadEnv } from './env-file.js';
import { listLessonChoices, readLesson, lessonDir } from './lessons.js';
import { createPlatform, checkRequires } from './process.js';
import { lanAddresses, probePort } from './net.js';
import { qrSvg } from './qr.js';
import { pipeLines, sourceStale } from './build.js';
import * as backups from './backup.js';
import * as roster from './roster.js';
import { checkLessonInWorker } from '../lib/check-in-worker.js';
import * as lessonAdmin from './lesson-admin.js';
import { readUpload } from './upload.js';
import { checkPlatformFiles } from '../lib/platform-files.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const userError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
export const PLATFORM_LIST_MAX = 20;

// K7：设置页"版本"一行（平台文件完好 / 有 N 处改动）
export function platformFilesInfo(root) {
  const r = checkPlatformFiles(root);
  let version = r.version;
  if (!version) {
    try {
      version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? null;
    } catch {
      version = null;
    }
  }
  if (!r.checked) return { checked: false, version };
  const cut = (a) => a.slice(0, PLATFORM_LIST_MAX);
  return {
    checked: true, version, builtAt: r.builtAt, total: r.total, changes: r.changes,
    modified: cut(r.modified), missing: cut(r.missing), added: cut(r.added),
  };
}

function tokenOk(given, token) {
  if (typeof given !== 'string' || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function fileSize(f) {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
}

export function createManageServer({
  root,
  token,
  port = 0,
  host = '127.0.0.1',
  platform,
  serverCommand,
  buildCommand,
  fetchCommand,
  statfs = fs.statfsSync,
  log = (m) => console.log(m),
  checkLesson = (projectRoot, rel) => checkLessonInWorker(rel, { root: projectRoot, componentsRoot: path.join(projectRoot, 'components') }),
  openFolder = (dir) => lessonAdmin.openFolder(dir),
  maxDraftBytes = lessonAdmin.MAX_DRAFT_BYTES,
}) {
  if (!token) throw new Error('token required');
  platform ??= createPlatform({ root, serverCommand, buildCommand, log, checkLesson });
  const lastChecks = new Map(); // L1：每门课最近一次 POST /api/lesson/check 的结果（课程路径 → 结果）
  const backupDir = path.join(root, 'backups');
  const dbPath = () => path.resolve(root, effectiveEnv(root).DB_PATH);
  const clients = new Set();
  const fetchState = { running: false, child: null, lines: [], result: null };
  let exclusive = null; // 正在恢复 / 离线重置时，禁止启动平台

  // ===== SSE =====
  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  }
  const platformPayload = () => ({ ...platform.status(), pendingRestart: platform.pendingRestart() });
  // M3：build.stale（运行中且课程源文件比上次准备页面新）缓存 5 s，平台状态变化时作废
  const STALE_TTL = 5000;
  let staleCache = null;
  const buildStale = () => {
    if (platform.status().state !== 'running') return false;
    const now = Date.now();
    if (!staleCache || now - staleCache.at > STALE_TTL) staleCache = { at: now, value: sourceStale(root) };
    return staleCache.value;
  };
  const onState = () => {
    staleCache = null;
    broadcast('platform', platformPayload());
  };
  const onLog = (line) => broadcast('log', { line });
  const onBuild = (line) => broadcast('build', { line });
  platform.on('state', onState);
  platform.on('log', onLog);
  platform.on('build', onBuild);
  const keepAlive = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 20000);
  keepAlive.unref();

  // 数据操作串行（原 manage.sh 的互斥锁）
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  // 离线直接读写库之前：.env 的端口被占，说明平台很可能正由别的窗口（另一个管理台或命令行）运行着，
  // 此时直接改库会与运行中的平台冲突，拒绝
  async function guardOffline() {
    const p = Number(effectiveEnv(root).PORT);
    if (Number.isInteger(p) && p > 0 && p <= 65535 && (await probePort(p)) === 'in-use') {
      throw userError('平台似乎正在别的窗口里运行，请先关掉那个窗口', 409);
    }
  }

  // 名单 / 重置的目标：运行中走平台端点，已停止直接读写库（先 guardOffline），过渡状态请稍候
  async function target() {
    const s = platform.status();
    if (s.state === 'running') return { port: s.port, online: true };
    if (s.state === 'stopped') {
      await guardOffline();
      return { dbPath: dbPath(), online: false };
    }
    throw userError('平台正在启动或停止，请稍候再试', 409);
  }

  async function lessonInfo(rel) {
    try {
      const l = await readLesson(root, rel);
      if (!l) return { path: rel, id: null, title: null, dir: null, error: '找不到这门课程的配置文件', missing: true };
      const dir = lessonDir(rel);
      const stages = l.config?.stages;
      return { path: rel, id: l.id, title: l.title, dir, dev: dir === '', stageCount: Array.isArray(stages) ? stages.length : 0 };
    } catch (err) {
      return { path: rel, id: null, title: null, dir: null, error: String(err?.message ?? err) };
    }
  }

  async function pyodideInfo(rel) {
    const info = { needed: false, ready: false, version: null, fileCount: 0, totalSize: 0, fetchedAt: null, fetching: fetchState.running, result: fetchState.result };
    try {
      info.needed = (await checkRequires(root, rel)).needed;
    } catch {
      // 课程读不出时按不需要显示；启动时会报具体原因
    }
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'pyodide', 'manifest.json'), 'utf8'));
      const files = Object.values(m.files ?? {});
      Object.assign(info, {
        ready: true,
        version: m.version ?? null,
        fileCount: files.length,
        totalSize: files.reduce((n, f) => n + (Number(f?.size) || 0), 0),
        fetchedAt: m.fetchedAt ?? null,
      });
    } catch {
      // 未下载
    }
    return info;
  }

  async function dataInfo() {
    const file = dbPath();
    const list = backups.listBackups(backupDir);
    const out = {
      dbSize: fileSize(file) + fileSize(`${file}-wal`),
      students: 0,
      rosterCount: 0,
      bound: 0,
      lastBackup: list.length ? { file: list[0].file, mtime: list[0].mtime } : null,
    };
    try {
      const t = await target();
      const r = await roster.status(t);
      out.rosterCount = r.count;
      out.bound = r.bound;
      out.students = roster.countStudents({ dbPath: file, online: t.online });
    } catch {
      // 过渡状态或读取失败：留 0，页面稍后刷新
    }
    return out;
  }

  function urlsFor(p) {
    const sfx = p === 80 ? '' : `:${p}`;
    const student = lanAddresses().map((ip) => `http://${ip}${sfx}/`);
    return {
      port: p,
      student,
      teacher: `http://localhost${sfx}/teacher`,
      qr: student.length ? qrSvg(student[0]) : null,
    };
  }

  // ===== Pyodide 下载 =====
  function startFetch() {
    if (fetchState.running) throw userError('已经在下载了，请稍候', 409);
    const cmd = fetchCommand ?? [process.execPath, path.join(root, 'scripts', 'fetch-pyodide.mjs')];
    // .env 里的 RUNTIME_ZIP_URL / PYODIDE_MIRROR / PYPI_MIRROR / FONT_URL 传给下载脚本（国内镜像与 Gitee 同步规格 §4）
    const child = spawn(cmd[0], cmd.slice(1), { cwd: root, env: downloadEnv(root), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    Object.assign(fetchState, { running: true, child, lines: [], result: null });
    const onLine = (line) => {
      fetchState.lines.push(line);
      if (fetchState.lines.length > 200) fetchState.lines.shift();
      broadcast('fetch', { line });
    };
    pipeLines(child.stdout, onLine);
    pipeLines(child.stderr, onLine);
    child.once('error', (err) => onLine(`下载程序无法启动：${err.message}`));
    child.once('close', (code) => {
      const result = { done: true, ok: code === 0, code, at: Date.now(), tail: fetchState.lines.slice(-20) };
      Object.assign(fetchState, { running: false, child: null, result });
      broadcast('fetch', result);
    });
  }

  // ===== 路由 =====
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
  app.get('/ui-logic.js', (_req, res) => res.type('text/javascript').sendFile('ui-logic.js', { root: HERE }));

  const api = express.Router();
  api.use((req, res, next) => {
    const given = req.get('X-Manage-Token') ?? (req.method === 'GET' && req.path === '/events' ? req.query.t : undefined);
    if (!tokenOk(given, token)) return res.status(401).json({ error: '管理台链接已失效，请回到终端窗口里重新打开链接' });
    next();
  });
  api.use(express.json({ limit: '2mb' }));

  api.get('/overview', async (_req, res) => {
    const env = effectiveEnv(root);
    const s = platform.status();
    const p = s.state === 'running' ? s.port : Number(env.PORT);
    const lesson = await lessonInfo(env.LESSON_CONFIG);
    // M3 审查：上课面板显示平台正在跑的课（启动时记录），.env 里换了课要重启才生效
    const runningLesson = s.state === 'running' && s.lessonConfig ? await lessonInfo(s.lessonConfig) : null;
    res.json({
      platform: s,
      urls: urlsFor(p),
      lesson,
      runningLesson,
      // 向导（M3）：密码已设、课程可读（根目录配置"我的课程（自定义）"也算已选）
      setup: { passwordSet: Boolean(env.TEACHER_PASSWORD), lessonChosen: !lesson.error },
      pyodide: await pyodideInfo(env.LESSON_CONFIG),
      data: await dataInfo(),
      pendingRestart: platform.pendingRestart(),
      build: { stale: buildStale() },
      // L1：当前课最近一次检查结果（"检查课程"按钮或启动前的检查，取较新的；没查过为 null）
      check: [lastChecks.get(env.LESSON_CONFIG), s.check].filter((c) => c && c.path === env.LESSON_CONFIG).sort((a, b) => b.at - a.at)[0] ?? null,
    });
  });

  // L1：检查课程（check:lesson）。缺省查 .env 当前课；body.path 可查设置页下拉里的别的课（须在课程列表里）
  api.post('/lesson/check', async (req, res) => {
    const current = effectiveEnv(root).LESSON_CONFIG;
    const want = req.body?.path ?? current;
    if (typeof want !== 'string' || want === '') throw userError('课程路径不对');
    if (want !== current) {
      const paths = (await listLessonChoices(root, { warn: log })).map((l) => l.path);
      if (!paths.includes(want)) throw userError('没有这门课程');
    }
    const r = await checkLesson(root, want);
    const out = { ...r, path: want, at: Date.now() };
    lastChecks.set(want, out);
    res.json(out);
  });

  api.get('/settings', (_req, res) => {
    const { values, exists } = readEnv(root);
    const eff = effectiveEnv(root);
    res.json({
      values: settingsView({ ...values, PORT: eff.PORT, LESSON_CONFIG: eff.LESSON_CONFIG }),
      exists,
      os: process.platform,
      // Linux 非 root 绑定 < 1024 需要权限；macOS（10.14 起）与 Windows 不需要
      lowPortNeedsAdmin: process.platform === 'linux' && (typeof process.getuid !== 'function' || process.getuid() !== 0),
      pendingRestart: platform.pendingRestart(),
      platformFiles: platformFilesInfo(root),
    });
  });

  api.put('/settings', async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const patch = prepareSettingsPatch(body);
    const current = effectiveEnv(root).LESSON_CONFIG;
    const lessonPaths = [...(await listLessonChoices(root, { warn: log })).map((l) => l.path), current];
    const v = validateSettings(patch, { lessonPaths });
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    try {
      writeEnv(root, patch);
    } catch (err) {
      return res.status(400).json({ errors: { _: err.message } });
    }
    res.json({ ok: true, pendingRestart: platform.pendingRestart() });
  });

  api.get('/lessons', async (_req, res) => {
    res.json(await listLessonChoices(root, { warn: log }));
  });

  // ===== M4 课程页（发布包与课程管理规格 §4）：:scope/:name 即课程目录 lessons/<名> 或 examples/<名> =====
  const currentConfig = () => effectiveEnv(root).LESSON_CONFIG;
  api.get('/lessons/overview', async (_req, res) => {
    res.json(await lessonAdmin.lessonOverview(root, { current: currentConfig() }));
  });
  api.get('/lessons/templates', (_req, res) => {
    const t = lessonAdmin.templateFiles(root);
    res.json({ docx: fs.existsSync(t.docx), md: fs.existsSync(t.md) });
  });
  for (const kind of ['docx', 'md']) {
    api.get(`/lessons/template.${kind}`, (_req, res) => {
      const file = lessonAdmin.templateFiles(root)[kind];
      if (!fs.existsSync(file)) throw userError(lessonAdmin.MESSAGES.noTemplate, 404);
      res.attachment(kind === 'docx' ? '教学设计模板.docx' : '教学设计模板.md');
      // root + 文件名：路径里有点开头的目录（如 .claude/worktrees）时 send 默认会拒绝
      res.sendFile(path.basename(file), { root: path.dirname(file) });
    });
  }
  // 新建：id 由服务端定，newLesson 顺带把它设为当前课程
  api.post('/lessons', async (req, res) => {
    const r = await serial(() => lessonAdmin.createLesson(root, { title: req.body?.title }));
    const lesson = await lessonAdmin.lessonRow(root, 'lessons', r.id, { current: currentConfig() });
    res.json({ ok: true, lesson, pendingRestart: platform.pendingRestart() });
  });
  // 设为当前课程：与设置页一样写 .env 的 LESSON_CONFIG；平台运行中且与正在上的课不同 → differsFromRunning（重启后生效）
  api.post('/lessons/:scope/:name/current', async (req, res) => {
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name);
    const row = await lessonAdmin.lessonRow(root, d.scope, d.name);
    if (row.broken) throw userError(lessonAdmin.MESSAGES.broken, 400);
    writeEnv(root, { LESSON_CONFIG: d.configRel });
    const s = platform.status();
    const differsFromRunning = s.state === 'running' && Boolean(s.lessonConfig) && !lessonAdmin.sameLessonPath(s.lessonConfig, d.configRel);
    res.json({ ok: true, pendingRestart: platform.pendingRestart(), differsFromRunning });
  });
  api.post('/lessons/:scope/:name/draft', async (req, res) => {
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name, { mineOnly: lessonAdmin.MESSAGES.exampleNoUpload });
    const file = await readUpload(req, { maxBytes: maxDraftBytes });
    const r = await serial(() => lessonAdmin.saveDraft(d.abs, file));
    res.json({ ok: true, ...r });
  });
  api.post('/lessons/:scope/:name/open', async (req, res) => {
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name);
    if (!(await openFolder(d.abs))) throw userError(lessonAdmin.MESSAGES.openFailed, 500);
    res.json({ ok: true });
  });
  api.get('/lessons/:scope/:name/opening', async (req, res) => {
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name, { mineOnly: lessonAdmin.MESSAGES.exampleNoOpening });
    const row = await lessonAdmin.lessonRow(root, d.scope, d.name);
    if (row.broken) throw userError(lessonAdmin.MESSAGES.broken, 400);
    res.type('text/plain; charset=utf-8').send(lessonAdmin.openingText({ title: row.title, rel: d.rel, draft: row.draft }));
  });
  // 删除：只允许我的课、不是当前课程、平台已停止或正在上别的课（准备中一律拒绝）；移到 backups/deleted-lessons/
  api.delete('/lessons/:scope/:name', async (req, res) => {
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name, { mineOnly: lessonAdmin.MESSAGES.exampleNoDelete });
    if (lessonAdmin.sameLessonPath(currentConfig(), d.configRel)) throw userError(lessonAdmin.MESSAGES.deleteCurrent, 409);
    const s = platform.status();
    // 准备中 / 启动中 / 停止中：还不知道最终上哪门课，一律不删
    if (s.state !== 'stopped' && s.state !== 'running') throw userError(lessonAdmin.MESSAGES.deletePreparing, 409);
    if (s.state === 'running' && lessonAdmin.sameLessonPath(s.lessonConfig, d.configRel)) {
      throw userError(lessonAdmin.MESSAGES.deleteRunning, 409);
    }
    const r = await serial(async () => lessonAdmin.deleteLesson(root, d));
    res.json({ ok: true, movedTo: r.movedTo });
  });

  const busy = (res, message) => res.status(409).json({ ok: false, error: message });
  api.post('/platform/start', (req, res) => {
    const stopOld = req.body?.stopOld ?? null;
    if (stopOld !== null && !(Number.isInteger(stopOld) && stopOld > 0)) throw userError('进程号不对');
    if (exclusive) return busy(res, exclusive);
    if (platform.status().state !== 'stopped') return busy(res, '平台已在运行或正在启动');
    platform.start({ stopOld }).catch((err) => log(`[manage] 启动出错：${err?.stack ?? err}`));
    res.json({ ok: true });
  });
  api.post('/platform/stop', (_req, res) => {
    platform.stop().catch((err) => log(`[manage] 停止出错：${err?.stack ?? err}`));
    res.json({ ok: true });
  });
  api.post('/platform/restart', (_req, res) => {
    if (exclusive) return busy(res, exclusive);
    platform.restart().catch((err) => log(`[manage] 重启出错：${err?.stack ?? err}`));
    res.json({ ok: true });
  });
  api.post('/platform/rebuild', (_req, res) => {
    if (platform.status().state !== 'stopped') return busy(res, '请先停止平台再重新构建');
    platform.rebuild().catch((err) => log(`[manage] 构建出错：${err?.stack ?? err}`));
    res.json({ ok: true });
  });

  api.get('/logs', (req, res) => {
    const n = Math.max(1, Math.min(500, Number.parseInt(req.query.lines, 10) || 50));
    res.json({ lines: platform.tail(n) });
  });

  api.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    res.write(`event: platform\ndata: ${JSON.stringify(platformPayload())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  // 名单
  api.get('/roster', async (_req, res) => {
    res.json(await roster.status(await target()));
  });
  api.post('/roster/preview', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string') throw userError('请粘贴名单文字');
    res.json(roster.preview(text));
  });
  api.post('/roster', async (req, res) => {
    const names = req.body?.names;
    if (!Array.isArray(names)) throw userError('名单格式不对');
    const r = await serial(async () => roster.importNames({ names, ...(await target()) }));
    res.json({ ok: true, count: r.count });
  });
  api.post('/roster/clear', async (_req, res) => {
    await serial(async () => roster.clear(await target()));
    res.json({ ok: true });
  });
  api.post('/roster/reset-bindings', async (_req, res) => {
    await serial(async () => roster.resetBindings(await target()));
    res.json({ ok: true });
  });

  // 备份 / 恢复 / 重置
  api.get('/backups', (_req, res) => {
    res.json(backups.listBackups(backupDir));
  });
  api.post('/backups', async (_req, res) => {
    const r = await serial(() => backups.backup({ dbPath: dbPath(), backupDir, statfs }));
    res.json({ file: r.file, size: r.size });
  });
  api.get('/backups/:file', (req, res) => {
    const { file } = req.params;
    if (!backups.isBackupName(file)) throw userError('备份文件名不对');
    const full = path.join(backupDir, file);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      throw userError('找不到这个备份', 404);
    }
    if (!st.isFile()) throw userError('找不到这个备份', 404);
    res.attachment(file);
    res.type('application/vnd.sqlite3');
    res.set('Content-Length', String(st.size));
    const stream = fs.createReadStream(full);
    stream.on('error', (err) => {
      log(`[manage] 备份下载失败：${err?.message ?? err}`);
      if (!res.headersSent) res.status(500).json({ error: '读取备份文件失败' });
      else res.destroy(err);
    });
    stream.pipe(res);
  });
  api.post('/backups/:file/restore', async (req, res) => {
    const { file } = req.params;
    if (!backups.isBackupName(file)) throw userError('备份文件名不对');
    const r = await serial(async () => {
      if (platform.status().state !== 'stopped') throw userError('请先停止平台，再恢复备份', 409);
      exclusive = '正在恢复备份，请稍候';
      try {
        await guardOffline();
        return await backups.restore({ dbPath: dbPath(), backupDir, file, statfs });
      } finally {
        exclusive = null;
      }
    });
    res.json({ ok: true, file: r.file, snapshot: r.snapshot });
  });
  api.post('/reset', async (req, res) => {
    if (req.body?.confirm !== true) throw userError('需要确认后才能重置');
    const r = await serial(async () => {
      const t = await target();
      if (t.online) return { ...(await backups.resetOnline({ port: t.port, dbPath: dbPath(), backupDir, statfs })), online: true };
      exclusive = '正在重置数据，请稍候';
      try {
        return { ...(await backups.resetOffline({ dbPath: dbPath(), backupDir, statfs })), online: false };
      } finally {
        exclusive = null;
      }
    });
    res.json({ ok: true, snapshot: r.snapshot, online: r.online });
  });

  api.post('/pyodide/fetch', (_req, res) => {
    startFetch();
    res.json({ ok: true });
  });

  api.use((_req, res) => res.status(404).json({ error: '没有这个功能' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500 && !err.expose) log(`[manage] ${err?.stack ?? err}`);
    res.status(status).json({ error: err.expose || status < 500 ? err.message : `操作失败：${err.message}` });
  });
  app.use('/api', api);

  let httpServer = null;
  const self = {
    app,
    platform,
    // 同步结束平台与下载子进程（管理台进程 'exit' 时用）
    killChildrenNow() {
      platform.killNow();
      try {
        fetchState.child?.kill();
      } catch {
        // ignore
      }
    },
    url: null,
    // listen(p?)：可换端口重试（入口在 3900–3909 间依次尝试）
    listen(p = port) {
      return new Promise((resolve, reject) => {
        httpServer = app.listen(p, host);
        httpServer.once('error', reject);
        httpServer.once('listening', () => {
          self.url = `http://127.0.0.1:${httpServer.address().port}/?t=${encodeURIComponent(token)}`;
          resolve(self.url);
        });
      });
    },
    async close() {
      clearInterval(keepAlive);
      platform.off('state', onState);
      platform.off('log', onLog);
      platform.off('build', onBuild);
      await platform.stop();
      fetchState.child?.kill();
      for (const res of clients) res.end();
      clients.clear();
      if (httpServer?.listening) {
        httpServer.closeAllConnections?.();
        await new Promise((r) => httpServer.close(() => r()));
      }
    },
  };
  return self;
}
