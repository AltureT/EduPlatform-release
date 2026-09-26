// createPythonClient(deps) → client；getPythonClient() 整页单例；__resetForTest(client?)（规格 §3.3、§3.8、§3.9、§3.10）
// 模块顶层无副作用：不建 Worker、不发请求；Worker 在第一次 ensure / run 时才建
//
// deps（均可缺省，测试注入）：
//   createWorker()       → Worker 形对象 { postMessage, terminate, onmessage, onerror }
//   fetch(url, init)     → manifest 检查与 stdin 信箱 POST
//   now() / setTimeout(fn, ms) / clearTimeout(t)
//   random()             → 32 位小写十六进制的信箱 key（缺省 crypto.getRandomValues；非安全上下文也可用）
//   navigator            → 备用档位降级判断（deviceMemory ≤ 2、iPad / iPhone）
//   sessionStorage       → "上次未正常卸载"标记（内存崩溃恢复后本次会话备用降为 off）
//   onPageHide(fn)       → 正常卸载时清标记
//   origin               → 拼绝对 URL（Worker 里的 import / XHR 不依赖 Worker 脚本位置）
//   checkBrowser()       → { ok, reason }（S3，compat.js）；第一次启动前调用一次，不通过则直接 failed（error = UNSUPPORTED_MESSAGE）
//
// client：getSnapshot() → { status, progress:{ phase, detail }, error, runs }（变化时整体换新）；subscribe(listener) → 取消函数；
//   ensure / writeFiles / run / test / http / stop / sendInput / restart（§3.3 签名）；configure({ standby })；
//   subscribe 的事件：{ type:'status', status, progress, error } / { type:'stdin-request', key, prompt } /
//   { type:'run-end', kind:'run'|'test', ok, error:{ type, message }|null, interrupted, tests? } / { type:'worker-created', key }
import { friendlyError } from './friendlyError.js';
import { PYODIDE_VERSION } from '../packages.js';
import { checkBrowser, UNSUPPORTED_MESSAGE } from './compat.js';

const USER_OPS = ['run', 'test', 'http'];
const ESCALATE_MS = 800;
const STANDBY_IDLE_MS = 2000;
const STANDBY_RETRY_MS = 30000;
const ERROR_SHOW_MS = 5000;
const INPUT_RETRIES = 3;
const FATAL_LIMIT = 3;
const ALIVE_KEY = 'sandbox:alive';
const NO_PROGRESS = Object.freeze({ phase: null, detail: '' });
const FETCH_HINT = '请在教师机运行 npm run fetch:pyodide';
const TAIL = 200 * 1024;

function defaultRandomKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultCreateWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

function safeSession() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

const msgOf = (e) => String(e?.message ?? e ?? 'error');
const call = (fn, ...args) => {
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch {
    // 调用者回调出错不影响运行
  }
};

export function createPythonClient(deps = {}) {
  const d = {
    createWorker: defaultCreateWorker,
    fetch: (...a) => globalThis.fetch(...a),
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (t) => globalThis.clearTimeout(t),
    random: defaultRandomKey,
    navigator: globalThis.navigator,
    sessionStorage: safeSession(),
    onPageHide: (fn) => globalThis.addEventListener?.('pagehide', fn),
    origin: globalThis.location?.origin ?? '',
    checkBrowser: () => checkBrowser(),
    ...deps,
  };
  const base = String(d.origin || '').replace(/\/$/, '');
  const MANIFEST_URL = `${base}/pyodide/manifest.json`;
  const INDEX_URL = `${base}/pyodide/v${PYODIDE_VERSION}/`;
  const STDIN_BASE = `${base}/api/c/sandbox/stdin/`;

  // ---------- 快照与事件 ----------
  let snap = Object.freeze({ status: 'idle', progress: NO_PROGRESS, error: null, runs: 0 });
  const listeners = new Set();
  const emit = (ev) => {
    for (const l of [...listeners]) call(l, ev);
  };
  function set(patch) {
    const next = { ...snap, ...patch };
    if (patch.progress === null) next.progress = NO_PROGRESS;
    if (next.status === snap.status && next.progress === snap.progress && next.error === snap.error && next.runs === snap.runs) return;
    snap = Object.freeze(next);
    emit({ type: 'status', status: snap.status, progress: snap.progress, error: snap.error });
  }
  let errorTimer = null;
  function showError(message) {
    if (errorTimer) d.clearTimeout(errorTimer);
    set({ error: message });
    errorTimer = d.setTimeout(() => {
      errorTimer = null;
      if (snap.error === message && snap.status !== 'failed') set({ error: null });
    }, ERROR_SHOW_MS);
  }

  // ---------- 备用档位 ----------
  let configured = 'full';
  let crashRecovered = false;
  try {
    crashRecovered = d.sessionStorage?.getItem(ALIVE_KEY) === '1';
  } catch {
    crashRecovered = false;
  }
  const ua = String(d.navigator?.userAgent ?? '');
  const lowMemory = (typeof d.navigator?.deviceMemory === 'number' && d.navigator.deviceMemory <= 2)
    || /iPad|iPhone/.test(ua)
    || (/Macintosh/.test(ua) && Number(d.navigator?.maxTouchPoints) > 1);
  const tier = () => {
    if (crashRecovered || configured === 'off') return 'off';
    if (configured === 'full' && lowMemory) return 'core';
    return configured;
  };
  let aliveMarked = false;
  function markAlive() {
    if (aliveMarked) return;
    aliveMarked = true;
    try {
      d.sessionStorage?.setItem(ALIVE_KEY, '1');
    } catch {
      // 隐私模式等：忽略
    }
  }
  try {
    d.onPageHide?.(() => {
      try {
        d.sessionStorage?.removeItem(ALIVE_KEY);
      } catch {
        // 忽略
      }
    });
  } catch {
    // 忽略
  }

  // ---------- 环境配方 ----------
  const recipe = { version: 0, packages: new Set(), flask: false, files: new Map() };

  // ---------- Worker 包装 ----------
  let seq = 0;
  const nextId = () => {
    seq = seq >= 99999999 ? 1 : seq + 1;
    return seq;
  };
  let active = null;
  let standby = null;

  function spawn() {
    const key = d.random();
    const worker = d.createWorker();
    const w = {
      worker, key, pending: new Map(), dead: false, coreReady: false, ready: false, syncing: null, resync: false,
      applied: { packages: new Set(), flask: false, files: new Map(), version: -1 },
    };
    worker.onmessage = (e) => onWorkerMessage(w, e?.data);
    worker.onerror = (e) => {
      e?.preventDefault?.();
      onWorkerFatal(w, msgOf(e));
    };
    markAlive();
    emit({ type: 'worker-created', key });
    return w;
  }

  function kill(w) {
    if (!w || w.dead) return;
    w.dead = true;
    try {
      w.worker.terminate();
    } catch {
      // 忽略
    }
    const pending = [...w.pending.values()];
    w.pending.clear();
    for (const p of pending) p.reject(Object.assign(new Error('terminated'), { terminated: true }));
  }

  // 发一条请求，返回 { id, promise }；on：该请求的流式消息回调
  function send(w, msg, on = {}) {
    const id = nextId();
    const promise = new Promise((resolve, reject) => {
      if (w.dead) return reject(Object.assign(new Error('terminated'), { terminated: true }));
      w.pending.set(id, { resolve, reject, on });
      try {
        w.worker.postMessage({ ...msg, id });
      } catch (e) {
        w.pending.delete(id);
        reject(e);
      }
    });
    return { id, promise };
  }
  const request = (w, msg, on) => send(w, msg, on).promise;

  function onWorkerMessage(w, m) {
    if (w.dead || !m || typeof m !== 'object') return;
    if (m.type === 'fatal') return onWorkerFatal(w, m.message);
    const p = w.pending.get(m.id);
    if (!p) return;
    switch (m.type) {
      case 'progress':
      case 'out':
      case 'image':
      case 'stdin-request':
        call(p.on[m.type], m);
        return;
      case 'fail':
        w.pending.delete(m.id);
        p.reject(new Error(m.message || 'fail'));
        return;
      default:
        w.pending.delete(m.id);
        p.resolve(m);
    }
  }

  // ---------- 操作队列 ----------
  let queue = [];
  let current = null;
  let manifestOk = false;
  let browser = null;   // S3：浏览器兼容检查结果（只做一次）
  let bootSeq = 0;
  let fatalStreak = 0;
  let standbyTimer = null;
  let standbyRetryTimer = null;
  let standbyRetries = 0;

  function enqueue(kind, args) {
    return new Promise((resolve, reject) => {
      const op = { kind, args, resolve, reject };
      if (snap.status === 'failed') {
        if (kind !== 'ensure') return reject(new Error('failed'));
        queue.push(op);
        boot('core');
        return;
      }
      queue.push(op);
      if (snap.status === 'idle') boot('core');
      else pump();
    });
  }

  function userOp(kind, args) {
    if (snap.status === 'failed') return Promise.reject(new Error('failed'));
    if (snap.status === 'running' || snap.status === 'waiting-input') return Promise.reject(new Error('busy'));
    return enqueue(kind, args);
  }

  function pump() {
    if (current || !active || !active.ready || active.dead) return;
    if (snap.status === 'failed') return;
    const op = queue.shift();
    if (!op) {
      scheduleStandby();
      return;
    }
    current = op;
    const w = active;
    const exec = { ensure: execEnsure, write: execWrite, run: execRun, test: execTest, http: execHttp }[op.kind];
    exec(op, w).catch(() => {});
  }

  // 一个操作正常结束：回到 ready、继续下一项
  function finish(op, w, { status = true } = {}) {
    if (current === op) current = null;
    if (active === w && !w.dead) {
      if (status) set({ status: 'ready', progress: null });
      pump();
    }
  }

  // ---------- 启动 / 重建 ----------
  async function checkManifest() {
    if (manifestOk) return null;
    try {
      const res = await d.fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!res || !res.ok) return `找不到 Python 运行时（manifest ${res?.status ?? '?'}），${FETCH_HINT}`;
      const j = await res.json();
      if (j?.version !== PYODIDE_VERSION) {
        return `Python 运行时版本不符（需要 ${PYODIDE_VERSION}，实际 ${j?.version ?? '未知'}），${FETCH_HINT}`;
      }
      manifestOk = true;
      return null;
    } catch (e) {
      return `无法读取 Python 运行时清单（${msgOf(e)}），${FETCH_HINT}`;
    }
  }

  async function boot(phase) {
    const mine = ++bootSeq;
    cancelStandbyTimers();
    // 连续致命错误计数：只在用户发起的全新启动（idle / failed → ensure、[重试]）时清零；
    // 致命错误后的自动重建（phase 'restart'）不清零，否则"反复致命错误 → failed"永远触发不了
    if (phase !== 'restart') fatalStreak = 0;
    // S3：浏览器太旧（缺 WebAssembly / 模块 Worker / BigInt …）→ 直接 failed，给一句明确提示，不进入含糊的 init 失败
    if (!browser) {
      try {
        browser = d.checkBrowser() ?? { ok: true, reason: null };
      } catch (e) {
        browser = { ok: false, reason: msgOf(e) };
      }
      if (!browser.ok) console.warn('[sandbox] 浏览器不满足运行条件：', browser.reason);
    }
    if (!browser.ok) return toFailed(UNSUPPORTED_MESSAGE);
    set({ status: 'loading', progress: { phase, detail: phase === 'restart' ? '重启运行环境' : 'Python 运行时' }, error: phase === 'restart' ? snap.error : null });
    const bad = await checkManifest();
    if (mine !== bootSeq) return;
    if (bad) return toFailed(bad);
    const w = spawn();
    active = w;
    try {
      await request(w, { type: 'init', indexURL: INDEX_URL, stdinUrl: STDIN_BASE + w.key }, {
        progress: (m) => {
          if (active === w && phase !== 'restart') set({ progress: { phase: 'core', detail: m.detail ?? '' } });
        },
      });
    } catch (e) {
      if (active !== w || w.dead) return;
      kill(w);
      active = null;
      return toFailed(`Python 运行时加载失败：${msgOf(e)}`);
    }
    if (active !== w || w.dead) return;
    w.coreReady = true;
    await completeBoot(w, phase);
  }

  // 核心已就绪：按配方补齐，然后 ready
  async function completeBoot(w, phase) {
    let err = null;
    try {
      err = await applyRecipe(w, phase);
    } catch {
      return;   // Worker 在补齐途中被终止
    }
    if (active !== w || w.dead) return;
    if (err) {
      showError(err);
      const ensures = queue.filter((q) => q.kind === 'ensure');
      queue = queue.filter((q) => q.kind !== 'ensure');
      for (const q of ensures) q.reject(new Error(err));
    }
    w.ready = true;
    set({ status: 'ready', progress: null });
    pump();
  }

  // 把 w 补齐到当前配方；返回第一条错误消息（包 / 文件失败）或 null；Worker 死掉时抛出
  async function applyRecipe(w, phase = null) {
    const target = recipe.version;
    const packages = [...recipe.packages].filter((p) => !w.applied.packages.has(p));
    const flask = recipe.flask && !w.applied.flask;
    let err = null;
    if (packages.length > 0 || flask) {
      if (phase && active === w) set({ progress: { phase: phase === 'restart' ? 'restart' : 'packages', detail: [...packages, ...(flask ? ['flask'] : [])].join(', ') } });
      try {
        await request(w, { type: 'load', packages, flask });
        for (const p of packages) w.applied.packages.add(p);
        if (flask) w.applied.flask = true;
      } catch (e) {
        if (w.dead) throw e;
        err = msgOf(e);
      }
    }
    const files = {};
    for (const [p, c] of recipe.files) if (w.applied.files.get(p) !== c) files[p] = c;
    if (Object.keys(files).length > 0) {
      if (phase && active === w) set({ progress: { phase: phase === 'restart' ? 'restart' : 'files', detail: Object.keys(files).join(', ') } });
      try {
        await request(w, { type: 'write', files });
        for (const [p, c] of Object.entries(files)) w.applied.files.set(p, c);
      } catch (e) {
        if (w.dead) throw e;
        err ??= msgOf(e);
      }
    }
    if (!err) w.applied.version = target;
    return err;
  }

  function toFailed(message) {
    cancelStandbyTimers();
    if (standby) {
      kill(standby);
      standby = null;
    }
    if (active) {
      kill(active);
      active = null;
    }
    if (errorTimer) {
      d.clearTimeout(errorTimer);
      errorTimer = null;
    }
    const pending = queue;
    queue = [];
    const op = current;
    current = null;
    set({ status: 'failed', progress: null, error: message });
    if (op) pending.unshift(op);
    for (const q of pending) q.reject(new Error(USER_OPS.includes(q.kind) ? 'failed' : message));
  }

  // ---------- 终止（stop / timeout / fatal / eof 升级 / restart） ----------
  function terminate(reason) {
    const w = active;
    if (!w) return;
    const op = current;
    current = null;
    clearOpTimers(op);
    kill(w);
    active = null;
    if (reason === 'fatal') {
      fatalStreak++;
      if (op?.ctx) call(op.ctx.onOutput, { kind: 'system', text: '运行环境已重启\n' });
    }
    if (op) {
      if (op.kind === 'run' || op.kind === 'test') {
        const result = op.kind === 'run' ? interruptedRun(op, reason) : interruptedTest(op);
        op.resolve(result);
        emitRunEnd(op.kind, result);
      } else if (op.kind === 'http') {
        op.reject(new Error(reason === 'timeout' ? 'timeout' : 'interrupted'));
      } else {
        queue.unshift(op);   // ensure / writeFiles：随配方重放后继续
      }
    }
    const rejected = queue.filter((q) => USER_OPS.includes(q.kind));
    queue = queue.filter((q) => !USER_OPS.includes(q.kind));
    for (const q of rejected) q.reject(new Error('restarted'));

    if (reason === 'fatal' && fatalStreak >= FATAL_LIMIT) {
      toFailed('运行环境反复出错，请刷新页面');
      return;
    }

    const sb = standby;
    const t = tier();
    if (sb && !sb.dead && standbyReady(sb, t)) {
      standby = null;
      cancelStandbyTimers();
      active = sb;
      if (t === 'full') {
        sb.ready = true;
        set({ status: 'ready', progress: null });
        pump();
      } else {
        bootSeq++;
        set({ status: 'loading', progress: { phase: 'restart', detail: '补装包' } });
        completeBoot(sb, 'restart');
      }
      return;
    }
    if (sb) {
      kill(sb);
      standby = null;
    }
    boot('restart');
  }

  function onWorkerFatal(w, message) {
    if (w.dead) return;
    if (w === standby) {
      kill(w);
      standby = null;
      retryStandbyLater();
      return;
    }
    if (w !== active) return;
    if (!w.coreReady) {
      kill(w);
      active = null;
      toFailed(`Python 运行时加载失败：${message}`);
      return;
    }
    terminate('fatal');
  }

  // ---------- 备用 Worker ----------
  function standbyReady(w, t) {
    if (!w.coreReady) return false;
    if (t === 'full') return !w.syncing && w.applied.version === recipe.version;
    return true;
  }

  function cancelStandbyTimers() {
    if (standbyTimer) {
      d.clearTimeout(standbyTimer);
      standbyTimer = null;
    }
  }

  const idle = () => snap.status === 'ready' && !current && queue.length === 0 && active?.ready && !active.dead;

  function scheduleStandby() {
    if (tier() === 'off' || standby || standbyTimer || standbyRetryTimer || !idle()) return;
    standbyTimer = d.setTimeout(() => {
      standbyTimer = null;
      if (!standby && tier() !== 'off' && idle()) spawnStandby();
    }, STANDBY_IDLE_MS);
  }

  function retryStandbyLater() {
    if (standbyRetries >= 1 || standbyRetryTimer) return;
    standbyRetries++;
    standbyRetryTimer = d.setTimeout(() => {
      standbyRetryTimer = null;
      scheduleStandby();
    }, STANDBY_RETRY_MS);
  }

  async function spawnStandby() {
    const w = spawn();
    standby = w;
    try {
      await request(w, { type: 'init', indexURL: INDEX_URL, stdinUrl: STDIN_BASE + w.key });
      if (standby !== w) return;
      w.coreReady = true;
      if (tier() === 'full') await syncStandby(w);
      if (standby === w) standbyRetries = 0;
    } catch {
      if (standby !== w) return;
      kill(w);
      standby = null;
      retryStandbyLater();
    }
  }

  // full 档：把备用补齐到配方；补齐期间配方又变了就再来一轮
  function syncStandby(w) {
    if (w.syncing) {
      w.resync = true;
      return w.syncing;
    }
    w.syncing = (async () => {
      do {
        w.resync = false;
        const err = await applyRecipe(w);
        if (err) throw new Error(err);
      } while (w.resync || w.applied.version !== recipe.version);
    })().finally(() => {
      w.syncing = null;
    });
    return w.syncing;
  }

  function onRecipeChanged() {
    const w = standby;
    if (!w || !w.coreReady || tier() !== 'full') return;
    syncStandby(w).catch(() => {
      if (standby !== w) return;
      kill(w);
      standby = null;
      retryStandbyLater();
    });
  }

  // ---------- 各操作 ----------
  async function execEnsure(op, w) {
    const packages = [...new Set(op.args.packages)].filter((p) => !recipe.packages.has(p));
    const flask = op.args.flask && !recipe.flask;
    if (packages.length === 0 && !flask) {
      op.resolve();
      return finish(op, w, { status: false });
    }
    set({ status: 'loading', progress: { phase: 'packages', detail: [...packages, ...(flask ? ['flask'] : [])].join(', ') } });
    try {
      await request(w, { type: 'load', packages, flask });
    } catch (e) {
      if (w.dead) return;
      op.reject(e);
      showError(msgOf(e));
      return finish(op, w);
    }
    if (w.dead) return;
    for (const p of packages) {
      recipe.packages.add(p);
      w.applied.packages.add(p);
    }
    if (flask) {
      recipe.flask = true;
      w.applied.flask = true;
    }
    recipe.version++;
    if (w.applied.version === recipe.version - 1) w.applied.version = recipe.version;
    op.resolve();
    finish(op, w);
    onRecipeChanged();
  }

  async function execWrite(op, w) {
    const files = { ...op.args.files };
    try {
      await request(w, { type: 'write', files });
    } catch (e) {
      if (w.dead) return;
      op.reject(e);
      return finish(op, w, { status: false });
    }
    if (w.dead) return;
    for (const [p, c] of Object.entries(files)) {
      recipe.files.set(p, c);
      w.applied.files.set(p, c);
    }
    recipe.version++;
    if (w.applied.version === recipe.version - 1) w.applied.version = recipe.version;
    op.resolve();
    finish(op, w, { status: false });
    onRecipeChanged();
  }

  function streamHandlers(op, w) {
    const ctx = op.ctx;
    return {
      out: (m) => {
        if (m.kind === 'stdout') ctx.stdout = (ctx.stdout + m.text).slice(-TAIL);
        else if (m.kind === 'stderr') ctx.stderr = (ctx.stderr + m.text).slice(-TAIL);
        call(ctx.onOutput, { kind: m.kind, text: m.text });
      },
      image: (m) => {
        ctx.images.push(m.png);
        ctx.imagesCompact.push(typeof m.compact === 'string' ? m.compact : null);
        call(ctx.onImage, m.png);
      },
      'stdin-request': (m) => {
        if (current !== op || active !== w) return;
        set({ status: 'waiting-input' });
        emit({ type: 'stdin-request', key: w.key, prompt: String(m.prompt ?? '') });
      },
    };
  }

  function startUserOp(op, w, msg, timeoutMs) {
    op.ctx = { id: null, stdout: '', stderr: '', images: [], imagesCompact: [], onOutput: op.args.onOutput, onImage: op.args.onImage, stopping: false, t0: d.now() };
    set({ status: 'running', progress: null, ...(op.kind === 'http' ? {} : { runs: snap.runs + 1 }) });
    const { id, promise } = send(w, msg, streamHandlers(op, w));
    op.ctx.id = id;
    if (timeoutMs > 0) {
      op.timer = d.setTimeout(() => {
        if (current === op && active === w) terminate('timeout');
      }, timeoutMs);
    }
    return promise;
  }

  function clearOpTimers(op) {
    if (!op) return;
    if (op.timer) d.clearTimeout(op.timer);
    if (op.escalate) d.clearTimeout(op.escalate);
    op.timer = null;
    op.escalate = null;
  }

  const elapsed = (op) => Math.max(0, Math.round(d.now() - op.ctx.t0));

  function interruptedRun(op, reason) {
    const ctx = op.ctx;
    let error = null;
    if (reason === 'timeout') error = { type: 'Timeout', message: '运行超时', ...friendlyError('Timeout', '运行超时', '') };
    if (reason === 'fatal') error = { type: 'Fatal', message: '运行环境出错，已重启', traceback: '', hint: '可以再运行一次' };
    return {
      ok: false, value: null, error, stdout: ctx.stdout, stderr: ctx.stderr,
      images: ctx.images, imagesCompact: ctx.imagesCompact, ms: elapsed(op), interrupted: true,
    };
  }

  function interruptedTest(op) {
    return { ok: false, passed: 0, failed: 0, errors: 0, total: 0, cases: [], stdout: op.ctx.stdout, ms: elapsed(op), interrupted: true };
  }

  function emitRunEnd(kind, r) {
    const ev = { type: 'run-end', kind, ok: !!r.ok, error: r.error ? { type: r.error.type, message: r.error.message } : null, interrupted: !!r.interrupted };
    if (kind === 'test') ev.tests = { passed: r.passed, failed: r.failed, errors: r.errors, total: r.total };
    emit(ev);
  }

  async function execRun(op, w) {
    const { code, files, timeoutMs } = op.args;
    let m;
    try {
      m = await startUserOp(op, w, { type: 'run', code, files }, timeoutMs);
    } catch (e) {
      if (w.dead) return;
      m = { ok: false, value: null, error: { type: 'RuntimeError', message: msgOf(e), traceback: '' }, stdout: op.ctx.stdout, stderr: op.ctx.stderr, ms: elapsed(op) };
    }
    if (w.dead || current !== op) return;
    clearOpTimers(op);
    fatalStreak = 0;
    const interrupted = op.ctx.stopping;
    const error = !interrupted && m.error
      ? { type: m.error.type, message: m.error.message, ...friendlyError(m.error.type, m.error.message, m.error.traceback) }
      : null;
    const result = {
      ok: interrupted ? false : !!m.ok,
      value: interrupted ? null : m.value ?? null,
      error,
      stdout: m.stdout ?? '',
      stderr: m.stderr ?? '',
      images: op.ctx.images,
      imagesCompact: op.ctx.imagesCompact,
      ms: Number.isFinite(m.ms) ? m.ms : elapsed(op),
      interrupted,
    };
    finish(op, w);
    op.resolve(result);
    emitRunEnd('run', result);
  }

  async function execTest(op, w) {
    const { code, tests, timeoutMs } = op.args;
    let m;
    try {
      m = await startUserOp(op, w, { type: 'test', code, tests }, timeoutMs);
    } catch (e) {
      if (w.dead) return;
      m = { ok: false, passed: 0, failed: 0, errors: 1, total: 0, cases: [{ name: 'pytest', ok: false, message: msgOf(e) }], stdout: op.ctx.stdout, ms: elapsed(op) };
    }
    if (w.dead || current !== op) return;
    clearOpTimers(op);
    fatalStreak = 0;
    const interrupted = op.ctx.stopping;
    const result = interrupted
      ? interruptedTest(op)
      : {
        ok: !!m.ok, passed: m.passed ?? 0, failed: m.failed ?? 0, errors: m.errors ?? 0, total: m.total ?? 0,
        cases: m.cases ?? [], stdout: m.stdout ?? '', ms: Number.isFinite(m.ms) ? m.ms : elapsed(op), interrupted: false,
      };
    finish(op, w);
    op.resolve(result);
    emitRunEnd('test', result);
  }

  async function execHttp(op, w) {
    const { method, path, body, headers, timeoutMs } = op.args;
    let m;
    try {
      m = await startUserOp(op, w, { type: 'http', method, path, body, headers }, timeoutMs);
    } catch (e) {
      if (w.dead || current !== op) return;
      clearOpTimers(op);
      finish(op, w);
      op.reject(e);
      return;
    }
    if (w.dead || current !== op) return;
    clearOpTimers(op);
    fatalStreak = 0;
    const { type: _t, id: _i, ...res } = m;
    finish(op, w);
    op.resolve(res);
  }

  // ---------- 信箱 ----------
  function postStdin(key, runId, body) {
    return d.fetch(`${STDIN_BASE}${key}/${runId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  const delay = (ms) => new Promise((r) => d.setTimeout(r, ms));

  // ---------- 公开方法（引用稳定） ----------
  const client = {
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    configure({ standby: s } = {}) {
      if (s === 'full' || s === 'core' || s === 'off') configured = s;
      if (tier() === 'off' && standby) {
        kill(standby);
        standby = null;
      }
    },
    ensure(packages = [], { flask = false } = {}) {
      const list = Array.isArray(packages) ? packages.filter((p) => typeof p === 'string' && p) : [];
      return enqueue('ensure', { packages: list, flask: !!flask });
    },
    writeFiles(files = {}) {
      return enqueue('write', { files: files && typeof files === 'object' ? files : {} });
    },
    run(code, { files = {}, timeoutMs = 0, onOutput, onImage } = {}) {
      return userOp('run', { code: String(code ?? ''), files: files ?? {}, timeoutMs, onOutput, onImage });
    },
    test(code, tests, { timeoutMs = 30000, onOutput } = {}) {
      return userOp('test', { code: String(code ?? ''), tests: tests ?? {}, timeoutMs, onOutput });
    },
    http(method, path, { body = null, headers = {}, timeoutMs = 10000 } = {}) {
      return userOp('http', { method: String(method || 'GET').toUpperCase(), path: String(path || '/'), body, headers, timeoutMs });
    },
    stop() {
      if (snap.status === 'waiting-input' && current && active) {
        const op = current;
        const w = active;
        if (op.ctx.stopping) return;
        op.ctx.stopping = true;
        postStdin(w.key, op.ctx.id, { eof: true }).catch(() => {});
        op.escalate = d.setTimeout(() => {
          if (current === op && active === w) terminate('stop');
        }, ESCALATE_MS);
        return;
      }
      if (snap.status === 'running' && current && active) {
        current.ctx.stopping = true;
        terminate('stop');
      }
    },
    async sendInput(line) {
      if (snap.status !== 'waiting-input' || !current || !active) throw new Error('not-waiting');
      const op = current;
      const w = active;
      const body = { line: String(line ?? '').slice(0, 4096) };
      for (let i = 0; i <= INPUT_RETRIES; i++) {
        try {
          const res = await postStdin(w.key, op.ctx.id, body);
          if (res?.ok) {
            if (current === op && active === w && snap.status === 'waiting-input') set({ status: 'running' });
            return;
          }
        } catch {
          // 重试
        }
        if (current !== op || active !== w) return;
        if (i < INPUT_RETRIES) await delay(300 * (i + 1));
      }
      call(op.ctx.onOutput, { kind: 'system', text: '输入没有送达，可以点停止\n' });
      throw new Error('input-failed');
    },
    restart() {
      if (snap.status === 'idle' || snap.status === 'failed') return;
      if (active) {
        if (current?.ctx) current.ctx.stopping = true;
        terminate('restart');
      }
    },
    // ---- 仅测试 / 调试 ----
    __recipe: () => ({
      version: recipe.version,
      packages: [...recipe.packages],
      flask: recipe.flask,
      files: Object.fromEntries(recipe.files),
    }),
    __standbyTier: () => tier(),
    __dispose() {
      bootSeq++;
      cancelStandbyTimers();
      if (standbyRetryTimer) d.clearTimeout(standbyRetryTimer);
      if (errorTimer) d.clearTimeout(errorTimer);
      clearOpTimers(current);
      kill(active);
      kill(standby);
      active = null;
      standby = null;
      listeners.clear();
    },
  };
  return client;
}

// ---------- 整页单例 ----------
let singleton = null;

export function getPythonClient() {
  if (!singleton) singleton = createPythonClient();
  return singleton;
}

// 测试用：丢弃当前单例（终止其 Worker）；传入 client 时以它作为新单例（S2 可注入假 client）
export function __resetForTest(client = null) {
  if (singleton && singleton !== client) singleton.__dispose?.();
  singleton = client;
}
