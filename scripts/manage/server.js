// 工作台 HTTP 服务（管理台规格 §4.7、§4.6）：只监听 127.0.0.1；/api/* 全部要求 X-Manage-Token
//   createManageServer({ root, token, port = 0, platform?, serverCommand?, buildCommand?, fetchCommand?, statfs?, log? })
//     → { app, platform, listen(port?) → Promise<url>, close(), killChildrenNow(), url }
//   url 形如 http://127.0.0.1:3900/?t=<token>；页面（public/ 与 /ui-logic.js）本身无需 token
//   M2：overview 增加 setup（引导条）、lesson.dev / stageCount、urls.qr（第一个学生地址的 SVG 二维码）；
//     POST /api/platform/start 可带 { stopOld: <进程号> }（"停止它并启动"，只对判定为本项目的旧平台生效）
//   M3：overview 增加 runningLesson（运行中平台启动时的课程，未运行 null）、lesson.missing（找不到，区别于写坏了读不出）、build.stale（运行中且课程源文件有更新，首页黄条"重启并应用"）；setup.lessonChosen 只看课程能否读出
//   EventSource 不能带自定义请求头，故 GET /api/events 另接受查询参数 t（只此一处）
//   S6：GET /api/ping 无鉴权 → { app: 'eduplatform-manage', root, pid, platformState, version }（不含 token 与其它信息）；
//     platformState 更新中 'updating'、离线恢复 / 重置或运行时下载中 'busy'，否则平台状态；pingInfo() 同内容（测试用）
//   L1：POST /api/lesson/check { path? } → { ok, errors, warnings, lesson, path, at }（check:lesson，worker 线程）；
//     overview.check = 当前课最近一次检查结果（本接口或启动前的检查，取较新的），没有则 null；checkLesson(root, rel) 可注入
//   M4：课程列表（第 1 步）接口 /api/lessons/overview、/templates、/template.{docx,md}、POST /api/lessons（新建）、
//     /api/lessons/:scope/:name/{current,draft,draft-text,open,opening}、DELETE /api/lessons/:scope/:name（lesson-admin.js）；
//     openFolder(dir) 与 maxDraftBytes 可注入（测试用）
//   G1（做课步骤引导规格 §2.3）：overview 增 platformDir（平台根目录绝对路径）；POST /api/platform/open → { ok }（openFolder(root)，打不开 500）
//   K7：GET /api/settings 多一项 platformFiles（框架自描述规格 §4）：{ checked, version, builtAt?, total?, changes?, modified?, missing?, added? }
//     ——版本.json 的 protected 清单与本机平台文件比对（三个数组各最多 PLATFORM_LIST_MAX 条）；没有 版本.json 时 checked: false、version 取 package.json
//   R4（管理台更新规格 §2–§4）：POST /api/update/check → { current, dev, latest, checkedAt, error? }（Gitee → GitHub，结果写 data/update-check.json）；
//     overview / settings 带 update: { current, dev, latest, checkedAt, running, result }（读缓存，不联网）；
//     POST /api/update/apply { version } → 起 scripts/update-platform.mjs 子进程，逐行经 SSE update 事件广播，结束时 update { done, ok, code, version, backupDir?, tail }；
//       起子进程前查磁盘空间（statfs 注入；包大小或 50 MB + 20 MB），不够 400"磁盘空间不够：还需要约 N MB，清理后再更新"（S9 更新容灾补强规格 §1.1）；发布页带包大小时传 --size；
//     成功 → 1 s 后调 onUpdated(version)（index.js 停平台、释放锁、以退出码 75 退出，入口脚本重启工作台）；
//     scheduleUpdateCheck({ delayMs })：启动静默检查（缓存不足 24 小时跳过，失败不写缓存）；fetch / updateSources / updateCommand 可注入（测试用）；
//     创建时先 recoverInterruptedUpdate（上次更新覆盖到一半被打断 → 按备份恢复），结果放 update.recovered（首页提示）；
//     waitForUpdate(ms) → Promise<boolean>：更新子进程在跑就等它结束（index.js 关闭时用，最多 60 s），不在跑立即 true
//   M6（名单与数据以课程为主体规格 §2.4、§2.5）：名单 / 备份 / 恢复 / 重置接口都带 ?lesson=<课程目录>（examples/x、lessons/x；'.' = 根目录开发课），
//     缺省 = 平台正在跑的课，没在跑则 .env 当前课；找不到 404、读不出 400。选中课正在跑（库与正在跑的课是同一个）→ 走平台接口；
//     否则直接读写它的库（平台停止时先 guardOffline；平台正在跑别的课时不用）。过渡状态 409。
//     备份接口另接受 lesson=_unsorted（迁移时读不出课程的旧库与旧备份目录 backups/）：只能列出、下载、备份一份、恢复到指定课程
//     （POST /api/backups/:file/restore?lesson=_unsorted { to: <课程目录>, allowOther? }）；恢复前读备份里的课程 id，与目标课不同且没带
//     allowOther: true → 409 { error, from, fromTitle }；POST /api/unsorted/delete { confirm: true } 把未归类的旧库移到 backups/deleted-lessons/。
//     overview.data 按正在跑 / 当前课，另带 custom（.env 自定义 DB_PATH）、unsorted { db, backups }；overview.migrated 见 migrate-db.js；
//     /api/lessons/overview 每行 data（lesson-admin.js lessonRow）
//   K8（AI 备用线路规格 §5）：POST /api/ai/test { which: 1 | 2, baseUrl, model, apiKey? } → { ok: true, ms } | { ok: false, reason, text }；
//     参数不对 400 { error }；出站请求用注入的 fetch（ai-test.js）
//   G3（管理台线性路径重设计规格 §2.4、§3）：/api/lessons、/api/lessons/overview 只列 lessons/（遗留的示例当前课例外）；
//     overview.currentLesson（lesson-admin.js currentLessonRow）；LESSON_CONFIG 空值 = 还没有课程（overview.lesson { none: true }）；
//     PUT /api/settings 的课程候选 = 我的课 + 根目录开发课 + 当前值；示例课不能设为当前课程（403）
//   G4（工作台两区重构规格 §1）：POST /api/lessons/rename { dir, title } → { ok, title, lesson }（只改 title；示例课 403）；
//     DELETE 当前课不再 409：删后当前课换成下一门 / 清空，响应带 current: { to } | null 与 pendingRestart
//   K9（AI 备用线路规格 §5.1）：POST /api/ai/models { which: 1 | 2, baseUrl, apiKey? } → { ok: true, models } | { ok: false, reason, text }；
//     参数不对 400 { error }；GET <baseUrl>/models 用注入的 fetch（ai-models.js）
//   S12（排障文件与 AI 排障规格 §1.2、§3）：出错时写 排障/ 文件（diagnosis.js），状态带 diagnosis: { file, at } | null——
//     平台启动失败（error.kind ∈ DIAG_KINDS）→ 环节"启动平台"、运行中意外退出 → "平台退出"：overview.platform / SSE platform 带 diagnosis
//       （文件异步写好后再广播一次）；"下载并更新"失败 → update.result.diagnosis；启动时恢复了上次没完成的更新 → update.recovered.diagnosis；
//       运行时下载失败 → env.pyodide.diagnosis（G4）。新一次启动 / 重新构建 / 更新 / 下载开始时清空。
//     GET /api/diagnosis/:name → 正文（text/markdown；名字不对 400、不存在 404）；POST /api/diagnosis/open → openFolder(排障/)（没有就建；打不开 500）
//   G4（工作台课程与平台两区重构规格 §3.1、§3.3）：环境自动准备（env-prepare.js），手动下载入口 POST /api/pyodide/fetch 删除。
//     触发时刻：工作台启动（listen 成功）、GET /api/overview、设为当前课程（POST …/current、PUT /api/settings 改 LESSON_CONFIG）、
//     新建 / 删除课程、POST /api/lesson/check 跑完；需要且缺 → 自动下载（fetchCommand 可注入），失败后 10 分钟内不自动重试（now 可注入）。
//     overview.env = 环境状态（env-prepare.js status()）；SSE 事件 env（同一形状，开始 / 进度变化 / 结束时发）；
//     POST /api/env/retry → { ok: true, started, env }（不受节流；正在下载时 started: false）；
//     下载失败写排障文件（环节"下载运行时"），放在 env.<种类>.diagnosis；旧的 overview.pyodide 已删（G4 收尾，页面只看 env）；
//     DELETE /api/lessons/:scope/:name 返回 cleaned（lesson-admin.js cleanupEnvironments：没有课再需要而清掉的环境种类，如 ['pyodide']）
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { effectiveEnv, readEnv, writeEnv, settingsView, prepareSettingsPatch, validateSettings, downloadEnv, customDbPath, passwordState } from './env-file.js';
import { migrateDb, takeMigratedNotice } from './migrate-db.js';
import { lessonIdError, UNSORTED_ID } from '../../kernel/server/lesson-db-path.js';
import { listLessons, listLessonChoices, readLesson, lessonDir, DEV_LESSON } from './lessons.js';
import { createPlatform, MANAGE_APP, withDiagHint } from './process.js';
import { createEnvPreparer } from './env-prepare.js';
import { lanAddresses, probePort } from './net.js';
import { qrSvg } from './qr.js';
import { pipeLines, sourceStale } from './build.js';
import * as backups from './backup.js';
import * as roster from './roster.js';
import { checkLessonInWorker } from '../lib/check-in-worker.js';
import * as lessonAdmin from './lesson-admin.js';
import { readUpload } from './upload.js';
import { parseAITest, runAITest } from './ai-test.js';
import { parseAIModels, fetchModels } from './ai-models.js';
import { checkPlatformFiles } from '../lib/platform-files.js';
import { writeDiagnosis, collectEnvironment, readDiagnosis, launcherSection, tailLines, DIAG_DIR, listDiagnoses } from './diagnosis.js';
import { checkReportText, updateResultText, updateRecoveredText } from './ui-logic.js';
import {
  checkUpdate, currentVersion, compareVersions, recoverInterruptedUpdate, fixupLaunchers, RELEASE_API, spaceShortage, downloadNeedBytes,
} from '../lib/update-platform.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const userError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
export const PLATFORM_LIST_MAX = 20;
export const UPDATE_CACHE = 'data/update-check.json';
export const UPDATE_CHECK_TTL = 24 * 3_600_000;
export const UPDATE_EXIT_DELAY = 1000;
// S12：这几类启动失败写排障文件（端口、密码、还没有课程、课程检查未通过页面上已有按钮直接解决，不写；G4 起缺运行时不再算启动失败）
export const DIAG_KINDS = new Set(['build', 'crash', 'timeout', 'internal', 'lesson']);
const DIAG_PHASE = { build: '构建', crash: '启动', timeout: '启动', internal: '内部错误', lesson: '读课程' };

// K7："平台"页"版本"一行（平台文件完好 / 有 N 处改动）
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
  fetch: fetchImpl = globalThis.fetch,
  updateSources = RELEASE_API,
  updateCommand,
  onUpdated = () => {},
  now = Date.now,
}) {
  if (!token) throw new Error('token required');
  platform ??= createPlatform({ root, serverCommand, buildCommand, log, checkLesson });
  const lastChecks = new Map(); // L1：每门课最近一次 POST /api/lesson/check 的结果（课程路径 → 结果）
  // V1：每张卡带该课最近一次检查的摘要（"检查课程"按钮或启动前的检查）
  const allChecks = () => [...lastChecks.values(), platform.status().check];
  // M6：名单 / 数据页选中的课。param = 课程目录（examples/x、lessons/x；'.' = 根目录开发课；缺省 = 正在跑的课，没在跑则 .env 当前课）；
  //   allowUnsorted 时另可选 '_unsorted'（未归类的旧数据）。→ { dir, configRel, id, title, dbPath, backupDir, running, unsorted, custom }
  //   running：平台在跑，且正在跑的课用的就是这个库（同 id 的两门课、自定义 DB_PATH 都算）
  async function selectLesson(param, { allowUnsorted = false } = {}) {
    await migrationDone;
    const customDb = customDbPath(root);
    const s = platform.status();
    if (param === UNSORTED_ID) {
      if (!allowUnsorted) throw userError('请先选一门课', 400);
      return { dir: UNSORTED_ID, configRel: null, id: UNSORTED_ID, title: null, ...backups.lessonPaths(root, UNSORTED_ID), running: false, unsorted: true, custom: false };
    }
    let rel;
    if (param === undefined || param === null || param === '') {
      rel = s.state === 'running' && s.lessonConfig ? s.lessonConfig : effectiveEnv(root).LESSON_CONFIG;
    } else {
      if (typeof param !== 'string') throw userError('课程位置不对，请刷新页面后再试');
      const want = param === '.' ? '' : param;
      const hit = (await lessonCandidates()).find((c) => c.dir === want);
      if (!hit) throw userError('找不到这门课程，可能已经删掉了；请刷新页面', 404);
      rel = hit.path;
    }
    const l = await readLesson(root, rel).catch(() => null);
    if (!l || lessonIdError(l.id)) throw userError('这门课程的文件有错，读不出来；请让帮你生成课程的 AI 检查后再试', 400);
    const paths = backups.lessonPaths(root, l.id, { customDb });
    // M6 审查：比较库路径——平台启动时记下的实际库（status().dbPath）与选中课的库相同才算正在跑；记不到时保守判为正在跑
    const running = s.state === 'running' && (!s.dbPath || path.resolve(paths.dbPath) === path.resolve(s.dbPath));
    return { dir: lessonDir(rel) || '.', configRel: rel, id: l.id, title: l.title ?? null, ...paths, running, unsorted: false, custom: Boolean(customDb) };
  }
  const lessonParam = (req) => req.query?.lesson ?? req.body?.lesson;
  // G3：可选的课 = 我的课 + .env 当前课（遗留示例课 / 根目录开发课）+ 平台正在跑的课（与当前课不同时）
  async function lessonCandidates() {
    const current = effectiveEnv(root).LESSON_CONFIG;
    const out = await listLessonChoices(root, { warn: log, current });
    const s = platform.status();
    if (s.state === 'running' && s.lessonConfig && !lessonAdmin.sameLessonPath(s.lessonConfig, current)) {
      for (const c of await listLessonChoices(root, { warn: () => {}, current: s.lessonConfig })) {
        if (!out.some((o) => o.dir === c.dir)) out.push(c);
      }
    }
    return out;
  }
  // M6（名单与数据以课程为主体规格 §2.2）：旧的全平台一个库 data/classroom.sqlite → data/lessons/<课程 id>.sqlite（一次）
  // M6 审查：.env 的端口被占（平台多半正由别的窗口跑着、旧库在用）→ 这次不整理，记日志，下次启动再试
  const migrationDone = (async () => {
    try {
      const p = Number(effectiveEnv(root).PORT);
      if (Number.isInteger(p) && p > 0 && p <= 65535 && (await probePort(p)) === 'in-use') {
        if (fs.existsSync(path.join(root, 'data', 'classroom.sqlite'))) log('[manage] 平台似乎正在别的窗口里运行，这次不整理旧课堂数据，下次启动工作台再试');
        return;
      }
      migrateDb(root, { customDb: customDbPath(root), log });
    } catch (err) {
      log(`[manage] 整理旧课堂数据时出错：${err?.message ?? err}`);
    }
  })();
  const clients = new Set();
  let exclusive = null; // 正在恢复 / 离线重置时，禁止启动平台
  // R4：更新子进程；waitingExit = 已更新成功、等工作台退出重启（期间同样禁止启动平台）
  const updateState = { running: false, child: null, lines: [], result: null, waitingExit: false };
  // 上次更新覆盖到一半被打断（Ctrl+C 之外的强行结束、断电、Windows 关窗口）→ 先恢复到更新前再开张
  let recovered = null;
  // S12：排障文件的环境里写工作台端口与启动时间（listen 后填端口）
  const manageInfo = { port: null, startedAt: Date.now() };
  const diagEnv = (extra = {}) => collectEnvironment(root, { manage: manageInfo, ...extra });
  const diag = (opts) => {
    const r = writeDiagnosis(root, { ...opts, log });
    return r ? { file: r.file, at: Date.now() } : null;
  };
  try {
    const recLines = [];
    const r = recoverInterruptedUpdate(root, { log: (m) => { recLines.push(m); log(m); } });
    // 'intact'（文件已完好）与 'running'（更新程序还在跑）不提示；恢复了或恢复失败才在首页说
    if (r && (r.action === 'rolled-back' || r.action === 'failed')) {
      recovered = { ok: r.ok, from: r.from, to: r.to, backupDir: r.backupDir, at: Date.now() };
      recovered.diagnosis = diag({
        stage: '更新', phase: '启动时恢复', message: updateRecoveredText({ recovered }).text,
        detail: [`v${r.from} → v${r.to}`, `备份：${r.backupDir}`, ...(r.errors ?? [])],
        environment: diagEnv(),
        sections: [{ title: '更新记录（最后 100 行）', lines: recLines.slice(-100) }, launcherSection(root)],
      });
    }
  } catch (err) {
    log(`[manage] 检查上次更新是否完成时出错：${err?.message ?? err}`);
  }
  // v0.6.1 热修：旧版本的更新脚本升上来时不认识新入口名——补 .command 执行权限、把旧入口挪进 backups/updates/
  try {
    fixupLaunchers(root, { log });
  } catch (err) {
    log(`[manage] 整理双击入口时出错：${err?.message ?? err}`);
  }
  const updating = () => updateState.running || updateState.waitingExit;
  const blockedBy = () => exclusive ?? (updating() ? '正在更新平台，请稍候' : null);
  // S6：GET /api/ping 的内容。platformState：更新中或更新成功等重启 → 'updating'；离线恢复 / 重置中或 Python 运行时下载中 → 'busy'；
  //   否则平台状态（stopped / building / starting / running / stopping）
  const pingState = () => {
    if (updating()) return 'updating';
    if (exclusive || envPrep.busy()) return 'busy';
    return platform.status().state;
  };
  const pingInfo = () => ({
    app: MANAGE_APP,
    root: path.resolve(root),
    pid: process.pid,
    platformState: pingState(),
    version: currentVersion(root).current,
  });

  // ===== SSE =====
  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  }
  // G4：环境自动准备（§3.1）；更新平台时不开始下载
  const envPrep = createEnvPreparer({
    root, fetchCommand, log, now,
    blocked: () => (updating() ? '正在更新平台' : null),
    diagnose: ({ reason, code, lines }) => diag({
      stage: '下载运行时', message: `Python 环境没准备好：${reason}`, detail: [code === null ? '下载程序没能启动' : `下载程序退出码 ${code}`],
      environment: diagEnv(),
      sections: [{ title: '下载记录（最后 100 行）', lines: lines.slice(-100) }, launcherSection(root)],
    }),
  });
  envPrep.on('change', (s) => broadcast('env', s));
  // 触发一次（不抛错）；→ 环境状态
  const triggerEnv = () => envPrep.trigger().catch((err) => {
    log(`[manage] 准备环境时出错：${err?.message ?? err}`);
    return envPrep.status();
  });
  // S12：平台启动失败 / 运行中意外退出的排障文件（diagnosis: { file, at } | null）
  let platformDiag = null;
  let diagFor = null; // 已为哪个 error 对象写过（同一个失败的多次状态事件只写一次）
  let diagGen = 0;
  let prevState = platform.status().state;
  const buildLines = []; // 这一次启动 / 重新构建的构建输出（最后 200 行）
  // 排障文件写成了，提示里的"查看详情"才换成"复制给 AI"（process.js withDiagHint）
  const platformStatus = () => {
    const s = platform.status();
    if (platformDiag && s.error) s.error = { ...s.error, message: withDiagHint(s.error.message) };
    return { ...s, diagnosis: platformDiag };
  };
  // 新一次启动 / 重新构建的入口：上一份排障文件不再对应当前错误（"还没有课程"这类不经过 building 的也清）
  const clearPlatformDiag = () => {
    diagGen++;
    platformDiag = null;
    diagFor = null;
  };
  const platformPayload = () => ({ ...platformStatus(), pendingRestart: platform.pendingRestart() });
  async function writePlatformDiag(s, gen) {
    const running = s.error.kind === 'crash' && s.error.phase === 'running';
    const env = effectiveEnv(root);
    const rel = running && s.lessonConfig ? s.lessonConfig : env.LESSON_CONFIG;
    let lesson = rel ? { path: rel } : null;
    if (rel) {
      const l = await readLesson(root, rel).catch(() => null);
      if (l) lesson = { path: rel, id: l.id, title: l.title ?? null };
    }
    if (gen !== diagGen) return;
    const sections = [];
    if (buildLines.length) sections.push({ title: '构建输出（最后 200 行）', lines: [...buildLines] });
    sections.push({ title: '平台运行记录（server.log 最后 200 行）', lines: tailLines(platform.logFile ?? path.join(root, 'data', 'logs', 'server.log'), 200) });
    sections.push(launcherSection(root));
    if (!running && s.check) sections.push({ title: '课程检查结果', lines: checkReportText(s.check, { title: lesson?.title ?? null }).split('\n') });
    const d = diag({
      stage: running ? '平台退出' : '启动平台',
      phase: running ? '运行中' : DIAG_PHASE[s.error.kind],
      message: withDiagHint(s.error.message),
      detail: s.error.detail,
      environment: diagEnv({ lesson, portOwner: s.error.owner ?? undefined }),
      sections,
    });
    if (gen !== diagGen || !d) return;
    platformDiag = d;
    broadcast('platform', platformPayload());
  }
  // M3：build.stale（运行中且课程源文件比上次准备页面新）缓存 5 s，平台状态变化时作废
  const STALE_TTL = 5000;
  let staleCache = null;
  const buildStale = () => {
    if (platform.status().state !== 'running') return false;
    const now = Date.now();
    if (!staleCache || now - staleCache.at > STALE_TTL) staleCache = { at: now, value: sourceStale(root) };
    return staleCache.value;
  };
  const onState = (s) => {
    staleCache = null;
    // S12：新一次启动 / 重新构建开始 → 清掉上次的排障文件提示与构建输出
    if ((s.state === 'starting' || s.state === 'building') && prevState === 'stopped') {
      diagGen++;
      platformDiag = null;
      diagFor = null;
      buildLines.length = 0;
    }
    prevState = s.state;
    if (s.state === 'stopped' && s.error && DIAG_KINDS.has(s.error.kind) && s.error !== diagFor) {
      diagFor = s.error;
      writePlatformDiag(s, ++diagGen).catch((err) => log(`[manage] 排障文件没能写：${err?.message ?? err}`));
    }
    broadcast('platform', platformPayload());
  };
  const onLog = (line) => broadcast('log', { line });
  const onBuild = (line) => {
    buildLines.push(line);
    if (buildLines.length > 200) buildLines.shift();
    broadcast('build', { line });
  };
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

  // 离线直接读写库之前：.env 的端口被占，说明平台很可能正由别的窗口（另一个工作台或命令行）运行着，
  // 此时直接改库会与运行中的平台冲突，拒绝
  async function guardOffline() {
    const p = Number(effectiveEnv(root).PORT);
    if (Number.isInteger(p) && p > 0 && p <= 65535 && (await probePort(p)) === 'in-use') {
      throw userError('平台似乎正在别的窗口里运行，请先关掉那个窗口', 409);
    }
  }

  // 名单 / 重置的目标（M6：按选中课）：选中课正在跑 → 平台端点；平台停止 → 直接读写库（先 guardOffline）；
  //   平台正在跑别的课 → 直接读写选中课的库；过渡状态请稍候
  async function target(sel) {
    const s = platform.status();
    if (sel.running) return { port: s.port, online: true };
    if (s.state === 'stopped') {
      await guardOffline();
      return { dbPath: sel.dbPath, online: false };
    }
    if (s.state === 'running') return { dbPath: sel.dbPath, online: false };
    throw userError('平台正在启动或停止，请稍候再试', 409);
  }

  async function lessonInfo(rel) {
    // G3：LESSON_CONFIG 空值 = 还没有课程
    if (!rel) return { path: '', missing: true, none: true };
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

  async function dataInfo() {
    const unsortedPaths = backups.lessonPaths(root, UNSORTED_ID);
    const custom = Boolean(customDbPath(root));
    const base = {
      dbSize: 0, students: 0, rosterCount: 0, bound: 0, lastBackup: null, custom,
      // 未归类的旧数据（迁移时读不出课程的旧库）与旧备份目录里的备份：数据页"未归类"一节
      unsorted: { db: !custom && fs.existsSync(unsortedPaths.dbPath), backups: custom ? 0 : backups.listBackups(unsortedPaths.backupDir).length },
    };
    let sel;
    try {
      sel = await selectLesson();
    } catch {
      return base;
    }
    const file = sel.dbPath;
    const list = backups.listBackups(sel.backupDir);
    const out = {
      ...base,
      dbSize: fileSize(file) + fileSize(`${file}-wal`),
      lastBackup: list.length ? { file: list[0].file, mtime: list[0].mtime } : null,
    };
    try {
      const t = await target(sel);
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

  // ===== R4 平台更新 =====
  const cacheFile = path.join(root, ...UPDATE_CACHE.split('/'));
  function readUpdateCache() {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return c && typeof c === 'object' ? c : null;
    } catch {
      return null;
    }
  }
  function updateInfo() {
    const { current, dev } = currentVersion(root);
    const c = readUpdateCache();
    // 缓存里的"最新"不比本机新（例如刚更新完）→ 不算有新版本
    const latest = c?.latest && current && compareVersions(c.latest.version, current) > 0 ? c.latest : null;
    return {
      current, dev, latest, checkedAt: c?.checkedAt ?? null,
      running: updateState.running, result: updateState.result, recovered,
    };
  }
  async function runUpdateCheck() {
    const r = await checkUpdate({ root, fetch: fetchImpl, sources: updateSources, warn: log });
    if (!r.error) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, `${JSON.stringify({ checkedAt: r.checkedAt, current: r.current, latest: r.latest }, null, 2)}\n`);
    }
    return r;
  }
  function startUpdate(version) {
    const { dev } = currentVersion(root);
    if (dev) throw userError('开发版不更新', 400);
    if (updating()) throw userError('已经在更新了，请稍候', 409);
    if (envPrep.busy()) throw userError('正在准备 Python 环境，请等它完成再更新', 409);
    if (exclusive) throw userError(exclusive, 409);
    const s = platform.status().state;
    if (s === 'running') throw userError('先停止平台再更新', 409);
    if (s !== 'stopped') throw userError('平台正在启动或停止，请稍候再试', 409);
    const latest = updateInfo().latest;
    if (!latest || typeof version !== 'string' || latest.version !== version) throw userError('要更新的版本不对，请重新检查更新', 409);
    // S9（更新容灾补强规格 §1.1）：起子进程前查磁盘空间（与子进程下载前同一算法：包大小或 50 MB，再加 20 MB）
    const short = spaceShortage(root, downloadNeedBytes(latest.size), statfs);
    if (short) throw userError(short, 400);
    const urls = (Array.isArray(latest.urls) && latest.urls.length ? latest.urls : [latest.url]).filter((u) => typeof u === 'string' && u);
    const cmd = updateCommand ?? [process.execPath, path.join(root, 'scripts', 'update-platform.mjs')];
    const size = Number.isInteger(latest.size) && latest.size > 0 ? ['--size', String(latest.size)] : [];
    const args = [...cmd.slice(1), '--version', version, ...urls.flatMap((u) => ['--url', u]), ...size, '--root', root];
    const child = spawn(cmd[0], args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    Object.assign(updateState, { running: true, child, lines: [], result: null });
    let backupDir = null;
    const onLine = (line) => {
      const m = /^(?:备份目录|更新前的文件备份在)：(.+)$/.exec(line);
      if (m) backupDir = m[1].trim();
      updateState.lines.push(line);
      if (updateState.lines.length > 200) updateState.lines.shift();
      broadcast('update', { line });
    };
    pipeLines(child.stdout, onLine);
    pipeLines(child.stderr, onLine);
    child.once('error', (err) => onLine(`更新程序无法启动：${err.message}`));
    child.once('close', (code) => {
      const ok = code === 0;
      const result = { done: true, ok, code, version, backupDir, at: Date.now(), tail: updateState.lines.slice(-20) };
      if (!ok) {
        result.diagnosis = diag({
          stage: '更新', phase: '下载并更新', message: updateResultText(result).text,
          detail: [`v${currentVersion(root).current ?? '?'} → v${version}`, `更新程序退出码 ${code}`, ...(backupDir ? [`备份：${backupDir}`] : [])],
          environment: diagEnv(),
          sections: [{ title: '更新记录（最后 100 行）', lines: updateState.lines.slice(-100) }, launcherSection(root)],
        });
      }
      Object.assign(updateState, { running: false, child: null, result, waitingExit: ok });
      broadcast('update', result);
      staleCache = null;
      if (ok) {
        log(`[manage] 平台已更新到 v${version}，工作台即将重新启动`);
        setTimeout(() => onUpdated(version), UPDATE_EXIT_DELAY);
      }
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
  // S6：无鉴权 ping（新开的工作台窗口据此判断旧窗口是不是本项目的、能不能替换）；只回这五项，不含 token
  app.get('/api/ping', (_req, res) => res.json(pingInfo()));

  const api = express.Router();
  api.use((req, res, next) => {
    const given = req.get('X-Manage-Token') ?? (req.method === 'GET' && req.path === '/events' ? req.query.t : undefined);
    if (!tokenOk(given, token)) return res.status(401).json({ error: '工作台链接已失效，请回到终端窗口里重新打开链接' });
    next();
  });
  api.use(express.json({ limit: '2mb' }));

  api.get('/overview', async (_req, res) => {
    await migrationDone;
    const envStatus = await triggerEnv();
    const env = effectiveEnv(root);
    const s = platformStatus();
    const p = s.state === 'running' ? s.port : Number(env.PORT);
    const lesson = await lessonInfo(env.LESSON_CONFIG);
    // M3 审查：上课面板显示平台正在跑的课（启动时记录），.env 里换了课要重启才生效
    const runningLesson = s.state === 'running' && s.lessonConfig ? await lessonInfo(s.lessonConfig) : null;
    // G3（管理台线性路径重设计规格 §3.1）：当前课的一行（lessonRow 同形；空值或找不到 null）
    const currentLesson = await lessonAdmin.currentLessonRow(root, env.LESSON_CONFIG, { checks: allChecks() });
    res.json({
      platform: s,
      urls: urlsFor(p),
      lesson,
      runningLesson,
      currentLesson,
      // 向导（M3）：密码已设、课程可读（根目录配置"我的课程（自定义）"也算已选）
      // S14：password = 'default'（为空或 123456）| 'set'；passwordSet 保留兼容（= 不为空）
      setup: { passwordSet: Boolean(env.TEACHER_PASSWORD), password: passwordState(env.TEACHER_PASSWORD), lessonChosen: !lesson.error && !lesson.none },
      // G4：课程需要的环境（§3.1）
      env: envStatus,
      data: await dataInfo(),
      pendingRestart: platform.pendingRestart(),
      build: { stale: buildStale() },
      // L1：当前课最近一次检查结果（"检查课程"按钮或启动前的检查，取较新的；没查过为 null）
      check: [lastChecks.get(env.LESSON_CONFIG), s.check].filter((c) => c && c.path === env.LESSON_CONFIG).sort((a, b) => b.at - a.at)[0] ?? null,
      update: updateInfo(),
      // G1：平台文件夹的位置（课程卡片"做课步骤"第 3 步显示，AI 开发工具要打开的就是它）
      platformDir: path.resolve(root),
      // M6 §2.2：旧课堂数据刚按课程整理过 → 首页提示一次（{ at, lessonId, unsorted }），之后 null
      migrated: takeMigratedNotice(root),
      // G5（工作台侧栏常规化规格 §1）：侧栏底部"排障文件 N"——排障/ 里的排障文件数（老师写的 -反馈.md 不计）
      diagnoses: { count: listDiagnoses(root).filter((d) => !/-反馈\.md$/.test(d.name)).length },
    });
  });

  // G1：课程卡片"做课步骤"第 3 步的"打开文件夹"——打开平台根目录
  api.post('/platform/open', async (_req, res) => {
    if (!(await openFolder(path.resolve(root)))) throw userError(lessonAdmin.MESSAGES.openFailed, 500);
    res.json({ ok: true });
  });

  // S12：排障文件正文（"复制给 AI"）与打开 排障/ 文件夹
  api.get('/diagnosis/:name', (req, res) => {
    res.type('text/markdown; charset=utf-8').send(readDiagnosis(root, req.params.name));
  });
  api.post('/diagnosis/open', async (_req, res) => {
    const dir = path.join(path.resolve(root), DIAG_DIR);
    fs.mkdirSync(dir, { recursive: true });
    if (!(await openFolder(dir))) throw userError(lessonAdmin.MESSAGES.openFailed, 500);
    res.json({ ok: true });
  });

  // L1：检查课程（check:lesson）。缺省查 .env 当前课；body.path 可查课程列表里的别的课（须在课程列表里）
  api.post('/lesson/check', async (req, res) => {
    const current = effectiveEnv(root).LESSON_CONFIG;
    const want = req.body?.path ?? current;
    if (typeof want !== 'string' || want === '') throw userError('课程路径不对');
    if (want !== current) {
      // V1：读不出来的课（课程列表（第 1 步） broken 的行）也能查——查出来的正是它为什么读不出来
      const choices = (await lessonCandidates()).map((l) => l.path);
      const rows = (await lessonAdmin.lessonOverview(root, { current })).map((r) => r.path);
      if (![...choices, ...rows].some((p) => lessonAdmin.sameLessonPath(p, want))) throw userError('没有这门课程');
    }
    const r = await checkLesson(root, want);
    const out = { ...r, path: want, at: Date.now() };
    lastChecks.set(want, out);
    await triggerEnv(); // G4：课程检查跑完（AI 做课加了写程序的段）
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
      update: updateInfo(),
    });
  });

  api.put('/settings', async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const patch = prepareSettingsPatch(body);
    const current = effectiveEnv(root).LESSON_CONFIG;
    // G3：候选 = 我的课 + 根目录开发课（有就算）+ 当前值；示例课不能选（遗留的当前值除外）
    const dev = fs.existsSync(path.join(root, 'lesson.config.js')) ? [DEV_LESSON] : [];
    const lessonPaths = [...(await listLessons(root, { warn: log })).map((l) => l.path), ...dev, current];
    const v = validateSettings(patch, { lessonPaths });
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    try {
      writeEnv(root, patch);
    } catch (err) {
      return res.status(400).json({ errors: { _: err.message } });
    }
    if (Object.hasOwn(patch, 'LESSON_CONFIG')) await triggerEnv(); // G4：换了当前课程
    res.json({ ok: true, pendingRestart: platform.pendingRestart() });
  });

  // K8：上课准备页"测一下"——用表单里的地址 / 模型（密钥留空用已保存的）发一次最小请求；不改 .env，平台运行与否都能测
  api.post('/ai/test', async (req, res) => {
    const p = parseAITest(req.body, readEnv(root).values);
    if (p.error) return res.status(400).json({ error: p.error });
    res.json(await runAITest(p.env, { fetch: fetchImpl }));
  });

  // K9：上课准备页"获取模型"——用表单里的地址（密钥留空用已保存的）列一次模型；不改 .env
  api.post('/ai/models', async (req, res) => {
    const p = parseAIModels(req.body, readEnv(root).values);
    if (p.error) return res.status(400).json({ error: p.error });
    res.json(await fetchModels({ baseUrl: p.baseUrl, apiKey: p.apiKey, fetch: fetchImpl }));
  });

  // G3：只列我的课；当前课是遗留示例课 / 根目录开发课时多出那一项
  api.get('/lessons', async (_req, res) => {
    res.json(await listLessonChoices(root, { warn: log, current: effectiveEnv(root).LESSON_CONFIG }));
  });

  // ===== M4 课程列表（第 1 步）（发布包与课程管理规格 §4）：:scope/:name 即课程目录 lessons/<名> 或 examples/<名> =====
  const currentConfig = () => effectiveEnv(root).LESSON_CONFIG;
  api.get('/lessons/overview', async (_req, res) => {
    await migrationDone;
    res.json(await lessonAdmin.lessonOverview(root, { current: currentConfig(), checks: allChecks() }));
  });
  // 新建：id 由服务端定，newLesson 顺带把它设为当前课程
  api.post('/lessons', async (req, res) => {
    const r = await serial(() => lessonAdmin.createLesson(root, { title: req.body?.title }));
    const lesson = await lessonAdmin.lessonRow(root, 'lessons', r.id, { current: currentConfig() });
    await triggerEnv(); // G4：新建课程
    res.json({ ok: true, lesson, pendingRestart: platform.pendingRestart() });
  });
  // 设为当前课程（G5：工作台左栏点课、全部课程页"设为当前课程"）：写 .env 的 LESSON_CONFIG；平台运行中且与正在上的课不同 → differsFromRunning（重启后生效）
  api.post('/lessons/:scope/:name/current', async (req, res) => {
    // G3：示例课不能设为当前课程（示例课只是给 AI 照抄的范本）
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name, { mineOnly: lessonAdmin.MESSAGES.exampleNoCurrent });
    const row = await lessonAdmin.lessonRow(root, d.scope, d.name);
    if (row.broken) throw userError(lessonAdmin.MESSAGES.broken, 400);
    writeEnv(root, { LESSON_CONFIG: d.configRel });
    const s = platform.status();
    const differsFromRunning = s.state === 'running' && Boolean(s.lessonConfig) && !lessonAdmin.sameLessonPath(s.lessonConfig, d.configRel);
    await triggerEnv(); // G4：设为当前课程
    res.json({ ok: true, pendingRestart: platform.pendingRestart(), differsFromRunning });
  });
  api.post('/lessons/:scope/:name/draft', async (req, res) => {
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name, { mineOnly: lessonAdmin.MESSAGES.exampleNoUpload });
    const file = await readUpload(req, { maxBytes: maxDraftBytes });
    const r = await serial(() => lessonAdmin.saveDraft(d.abs, file));
    res.json({ ok: true, ...r });
  });
  // S17：教案页粘贴的文字 { text } → 教学设计原稿.md（≤ 200 KB；示例课 403）
  api.post('/lessons/:scope/:name/draft-text', async (req, res) => {
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name, { mineOnly: lessonAdmin.MESSAGES.exampleNoUpload });
    const r = await serial(() => lessonAdmin.saveDraftText(d.abs, { text: req.body?.text }));
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
  // G4（工作台两区重构规格 §1）：重命名——body { dir: 'lessons/<名>', title }，只改 lesson.config.js 的 title；示例课 403
  api.post('/lessons/rename', async (req, res) => {
    const m = /^(lessons|examples)\/([^/\\]+)$/.exec(typeof req.body?.dir === 'string' ? req.body.dir : '');
    if (!m) throw userError(lessonAdmin.MESSAGES.badDir, 400);
    const d = lessonAdmin.resolveLessonDir(root, m[1], m[2], { mineOnly: lessonAdmin.MESSAGES.exampleNoRename });
    const r = await serial(() => lessonAdmin.renameLesson(root, d, { title: req.body?.title }));
    const lesson = await lessonAdmin.lessonRow(root, d.scope, d.name, { current: currentConfig() });
    res.json({ ok: true, title: r.title, lesson });
  });
  // 删除：只允许我的课、平台已停止或正在上别的课（准备中一律拒绝）；移到 backups/deleted-lessons/
  //   G4：当前课也能删——删后当前课换成列表里下一门（没有别的课就清空），返回 current: { to } | null
  api.delete('/lessons/:scope/:name', async (req, res) => {
    const d = lessonAdmin.resolveLessonDir(root, req.params.scope, req.params.name, { mineOnly: lessonAdmin.MESSAGES.exampleNoDelete });
    const s = platform.status();
    // 准备中 / 启动中 / 停止中：还不知道最终上哪门课，一律不删
    if (s.state !== 'stopped' && s.state !== 'running') throw userError(lessonAdmin.MESSAGES.deletePreparing, 409);
    if (s.state === 'running' && lessonAdmin.sameLessonPath(s.lessonConfig, d.configRel)) {
      throw userError(lessonAdmin.MESSAGES.deleteRunning, 409);
    }
    // M6 §2.3：这门课的库与备份一并移走——没有自定义 DB_PATH、且没有别的课与它同 id（同 id 共用一个库）时
    const row = await lessonAdmin.lessonRow(root, d.scope, d.name);
    const others = (await lessonAdmin.lessonOverview(root, { allExamples: true })).filter((x) => x.dir !== row.dir && x.id && x.id === row.id);
    const dev = await readLesson(root, './lesson.config.js').catch(() => null);
    const shared = others.length > 0 || (dev && dev.id === row.id);
    const dataId = !customDbPath(root) && row.id && !row.broken && !shared ? row.id : null;
    const r = await serial(async () => {
      // M6 审查：要移库时，平台停止状态下先确认没有别的窗口在跑（端口被占则 409）
      if (dataId && platform.status().state === 'stopped') await guardOffline();
      // G4 收尾：没有课再需要的环境，先停掉正在跑的下载（等它退出）再删目录
      return lessonAdmin.deleteLesson(root, d, { dataId, current: currentConfig(), beforeClean: (kind) => envPrep.stop(kind) });
    });
    await triggerEnv(); // G4：删除课程（清理在 deleteLesson 里，见 lesson-admin.js cleanupEnvironments）
    res.json({ ok: true, movedTo: r.movedTo, current: r.current, pendingRestart: platform.pendingRestart(), cleaned: r.cleaned ?? [] });
  });

  const busy = (res, message) => res.status(409).json({ ok: false, error: message });
  api.post('/platform/start', (req, res) => {
    const stopOld = req.body?.stopOld ?? null;
    if (stopOld !== null && !(Number.isInteger(stopOld) && stopOld > 0)) throw userError('进程号不对');
    if (blockedBy()) return busy(res, blockedBy());
    if (platform.status().state !== 'stopped') return busy(res, '平台已在运行或正在启动');
    clearPlatformDiag();
    platform.start({ stopOld }).catch((err) => log(`[manage] 启动出错：${err?.stack ?? err}`));
    res.json({ ok: true });
  });
  api.post('/platform/stop', (_req, res) => {
    platform.stop().catch((err) => log(`[manage] 停止出错：${err?.stack ?? err}`));
    res.json({ ok: true });
  });
  api.post('/platform/restart', (_req, res) => {
    if (blockedBy()) return busy(res, blockedBy());
    clearPlatformDiag();
    platform.restart().catch((err) => log(`[manage] 重启出错：${err?.stack ?? err}`));
    res.json({ ok: true });
  });
  api.post('/platform/rebuild', (_req, res) => {
    if (platform.status().state !== 'stopped') return busy(res, '请先停止平台再重新构建');
    if (updating()) return busy(res, '正在更新平台，请稍候');
    clearPlatformDiag();
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
  api.get('/roster', async (req, res) => {
    res.json(await roster.status(await target(await selectLesson(lessonParam(req)))));
  });
  api.post('/roster/preview', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string') throw userError('请粘贴名单文字');
    res.json(roster.preview(text));
  });
  api.post('/roster', async (req, res) => {
    const names = req.body?.names;
    if (!Array.isArray(names)) throw userError('名单格式不对');
    const r = await serial(async () => roster.importNames({ names, ...(await target(await selectLesson(lessonParam(req)))) }));
    res.json({ ok: true, count: r.count });
  });
  api.post('/roster/clear', async (req, res) => {
    await serial(async () => roster.clear(await target(await selectLesson(lessonParam(req)))));
    res.json({ ok: true });
  });
  api.post('/roster/reset-bindings', async (req, res) => {
    await serial(async () => roster.resetBindings(await target(await selectLesson(lessonParam(req)))));
    res.json({ ok: true });
  });

  // 备份 / 恢复 / 重置
  api.get('/backups', async (req, res) => {
    const sel = await selectLesson(lessonParam(req), { allowUnsorted: true });
    // 未归类备份带来源课程（恢复到指定课程时对话框要说"这份备份来自《X》"）
    res.json(backups.listBackups(sel.backupDir, { withLesson: sel.unsorted }));
  });
  api.post('/backups', async (req, res) => {
    const r = await serial(async () => {
      const sel = await selectLesson(lessonParam(req), { allowUnsorted: true });
      return backups.backup({ dbPath: sel.dbPath, backupDir: sel.backupDir, statfs });
    });
    res.json({ file: r.file, size: r.size });
  });
  // 下载：备份目录由选中课决定（白名单：backups/lessons/<id>/ 或 backups/），文件名仍须过 isBackupName（拒绝 ..）
  api.get('/backups/:file', async (req, res) => {
    const { file } = req.params;
    if (!backups.isBackupName(file)) throw userError('备份文件名不对');
    const full = path.join((await selectLesson(lessonParam(req), { allowUnsorted: true })).backupDir, file);
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
      const src = await selectLesson(lessonParam(req), { allowUnsorted: true });
      const to = req.body?.to;
      let dest = src;
      if (src.unsorted) {
        if (typeof to !== 'string' || to === '' || to === UNSORTED_ID) throw userError('请选要恢复到哪门课', 400);
        dest = await selectLesson(to);
      } else if (to !== undefined && to !== null && to !== src.dir) {
        throw userError('这份备份只能恢复到它自己的课', 400);
      }
      // 这门课没有在跑才能恢复（平台停止，或正在跑别的课）
      const state = platform.status().state;
      if (dest.running) throw userError('请先停止平台，再恢复备份', 409);
      if (state !== 'stopped' && state !== 'running') throw userError('平台正在启动或停止，请稍候再试', 409);
      if (updating()) throw userError('正在更新平台，请稍候', 409);
      // 核对来源：备份里记的课与目标课不同，要教师确认（allowOther: true）
      const from = dest.custom ? null : backups.backupLessonId(src.backupDir, file);
      if (from && from !== dest.id && req.body?.allowOther !== true) {
        const fromTitle = (await lessonCandidates()).find((c) => c.id === from)?.title ?? null;
        throw Object.assign(userError(`这份备份来自《${fromTitle ?? '另一门课'}》，确定恢复到《${dest.title ?? '这门课'}》？`, 409), { from, fromTitle });
      }
      exclusive = '正在恢复备份，请稍候';
      try {
        if (state === 'stopped') await guardOffline();
        const out = await backups.restore({ dbPath: dest.dbPath, backupDir: src.backupDir, snapshotDir: dest.backupDir, file, statfs });
        return { ...out, to: dest.dir };
      } finally {
        exclusive = null;
      }
    });
    res.json({ ok: true, file: r.file, snapshot: r.snapshot, to: r.to });
  });
  api.post('/reset', async (req, res) => {
    if (req.body?.confirm !== true) throw userError('需要确认后才能重置');
    const r = await serial(async () => {
      if (updating()) throw userError('正在更新平台，请稍候', 409);
      const sel = await selectLesson(lessonParam(req));
      const t = await target(sel);
      if (t.online) return { ...(await backups.resetOnline({ port: t.port, dbPath: sel.dbPath, backupDir: sel.backupDir, statfs })), online: true };
      exclusive = '正在重置数据，请稍候';
      try {
        return { ...(await backups.resetOffline({ dbPath: sel.dbPath, backupDir: sel.backupDir, statfs })), online: false };
      } finally {
        exclusive = null;
      }
    });
    res.json({ ok: true, snapshot: r.snapshot, online: r.online });
  });
  // M6 §2.2：未归类的旧数据"删除"——移到 backups/deleted-lessons/_unsorted-<时间>/（不直接删）
  api.post('/unsorted/delete', async (req, res) => {
    if (req.body?.confirm !== true) throw userError('需要确认后才能删除');
    const r = await serial(async () => backups.removeUnsorted(root));
    res.json({ ok: true, movedTo: r.movedTo });
  });

  // G4：环境"重试"（不受 10 分钟节流）
  api.post('/env/retry', async (_req, res) => {
    const r = await envPrep.retry();
    res.json({ ok: true, started: r.started, env: r.status });
  });

  // R4：检查更新（联网）/ 下载并更新
  api.post('/update/check', async (_req, res) => {
    res.json(await runUpdateCheck());
  });
  api.post('/update/apply', (req, res) => {
    startUpdate(req.body?.version);
    res.json({ ok: true });
  });

  api.use((_req, res) => res.status(404).json({ error: '没有这个功能' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500 && !err.expose) log(`[manage] ${err?.stack ?? err}`);
    const extra = err.from ? { from: err.from, fromTitle: err.fromTitle ?? null } : {};
    res.status(status).json({ error: err.expose || status < 500 ? err.message : `操作失败：${err.message}`, ...extra });
  });
  app.use('/api', api);

  let httpServer = null;
  const self = {
    app,
    platform,
    // 同步结束平台与下载子进程（工作台进程 'exit' 时用）
    killChildrenNow() {
      platform.killNow();
      envPrep.stop();
    },
    url: null,
    // R4：启动静默检查（listen 成功后由 index.js 调用；缓存不足 24 小时跳过；失败不写缓存、不提示）
    async scheduleUpdateCheck({ delayMs = 2000 } = {}) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs).unref?.());
      const c = readUpdateCache();
      if (c && Number.isFinite(c.checkedAt) && Date.now() - c.checkedAt < UPDATE_CHECK_TTL) return null;
      try {
        const r = await runUpdateCheck();
        if (!r.error) broadcast('update', { checked: true, latest: updateInfo().latest });
        return r;
      } catch (err) {
        log(`[manage] 检查更新出错：${err?.message ?? err}`);
        return null;
      }
    },
    isUpdating: () => updateState.running,
    pingInfo,
    waitForUpdate(ms = 60_000) {
      const child = updateState.child;
      if (!updateState.running || !child) return Promise.resolve(true);
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), ms);
        child.once('close', () => {
          clearTimeout(t);
          resolve(true);
        });
      });
    },
    // listen(p?)：可换端口重试（入口在 3900–3909 间依次尝试）
    listen(p = port) {
      return new Promise((resolve, reject) => {
        httpServer = app.listen(p, host);
        httpServer.once('error', reject);
        httpServer.once('listening', () => {
          self.url = `http://127.0.0.1:${httpServer.address().port}/?t=${encodeURIComponent(token)}`;
          manageInfo.port = httpServer.address().port;
          resolve(self.url);
          // G4：工作台启动时算一遍课程需要的环境，缺就自动准备
          migrationDone.then(triggerEnv);
        });
      });
    },
    async close() {
      clearInterval(keepAlive);
      platform.off('state', onState);
      platform.off('log', onLog);
      platform.off('build', onBuild);
      await platform.stop();
      envPrep.stop();
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
