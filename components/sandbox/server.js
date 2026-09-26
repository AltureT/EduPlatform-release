// sandbox 组件服务端（代码沙盒组件规格 §3.1、§3.2）
// 服务端不执行任何学生代码：只做配置校验、运行状态上报（s-status）、stdin 信箱 key 登记与信箱路由。
// 登记表与信箱表按 cctx 放在 WeakMap 里（register 与 http 收到同一个 cctx，共享；不放模块级，测试之间不串状态）
import { shape } from '#kernel/server/schema.js';
import { PACKAGES } from './packages.js';

const TEACHER_KEY = '__teacher__';
const KEY_RE = /^[0-9a-f]{32}$/;
const RUN_ID_RE = /^\d{1,8}$/;
const KEYS_PER_OWNER = 3;
const FILES_LIMIT_BYTES = 512 * 1024;
const COUNT_MAX = 100000;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const states = new WeakMap();
function stateOf(cctx) {
  let s = states.get(cctx);
  if (!s) {
    s = { keys: new Map(), boxes: new Map() };   // keys: Map<name | '__teacher__', key[]>；boxes: Map<'key/runId', entry>
    states.set(cctx, s);
  }
  return s;
}
// 仅供测试检查内部表
export const _stateOf = stateOf;

// ---------- 配置校验（§3.1） ----------

function checkPackages(where, list) {
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new Error(`sandbox: ${where}.packages must be an array of package names`);
  for (const p of list) {
    if (typeof p !== 'string' || !PACKAGES.includes(p)) {
      throw new Error(`sandbox: ${where}.packages: "${p}" is not an available package (allowed: ${PACKAGES.join(', ')})`);
    }
  }
}

function checkBool(where, key, v) {
  if (v !== undefined && typeof v !== 'boolean') throw new Error(`sandbox: ${where}.${key} must be a boolean`);
}

function checkEnum(where, key, v, values) {
  if (v !== undefined && !values.includes(v)) throw new Error(`sandbox: ${where}.${key} must be one of ${values.join(' | ')}`);
}

// 相对路径、不含 ..、不以 / 开头、非空
function validRelPath(p) {
  if (typeof p !== 'string' || p === '' || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

const STAGE_KEYS = ['packages', 'flask', 'files', 'tests', 'starter'];

function checkStageSandbox(stageId, sb) {
  const where = `stage "${stageId}" sandbox`;
  if (!isPlainObject(sb)) throw new Error(`sandbox: ${where} must be an object`);
  for (const k of Object.keys(sb)) {
    if (!STAGE_KEYS.includes(k)) throw new Error(`sandbox: ${where}: unknown key "${k}" (allowed: ${STAGE_KEYS.join(', ')})`);
  }
  checkPackages(where, sb.packages);
  checkBool(where, 'flask', sb.flask);
  if (sb.starter !== undefined && typeof sb.starter !== 'string') throw new Error(`sandbox: ${where}.starter must be a string`);
  let bytes = 0;
  if (sb.files !== undefined) {
    if (!isPlainObject(sb.files)) throw new Error(`sandbox: ${where}.files must be an object { 'path': 'content' }`);
    for (const [p, content] of Object.entries(sb.files)) {
      if (!validRelPath(p)) throw new Error(`sandbox: ${where}.files: invalid path ${JSON.stringify(p)} (relative, no ..)`);
      if (typeof content !== 'string') throw new Error(`sandbox: ${where}.files[${JSON.stringify(p)}] must be a string`);
      bytes += Buffer.byteLength(content, 'utf8');
    }
  }
  if (sb.tests !== undefined) {
    if (!isPlainObject(sb.tests)) throw new Error(`sandbox: ${where}.tests must be an object { 'test_x.py': 'source' }`);
    for (const [name, src] of Object.entries(sb.tests)) {
      if (!/^[A-Za-z0-9_]+\.py$/.test(name)) throw new Error(`sandbox: ${where}.tests: invalid file name ${JSON.stringify(name)} (like test_calc.py)`);
      if (typeof src !== 'string') throw new Error(`sandbox: ${where}.tests[${JSON.stringify(name)}] must be a string`);
      bytes += Buffer.byteLength(src, 'utf8');
    }
  }
  if (bytes > FILES_LIMIT_BYTES) {
    throw new Error(`sandbox: ${where}: files + tests total ${bytes} bytes exceeds 512 KB`);
  }
}

export function validateConfig(options, stages) {
  const o = options ?? {};
  checkPackages('options', o.packages);
  checkBool('options', 'flask', o.flask);
  checkEnum('options', 'preload', o.preload, ['join', 'stage']);
  checkEnum('options', 'standby', o.standby, ['full', 'core', 'off']);
  for (const s of stages) {
    if (s.config && s.config.sandbox !== undefined) checkStageSandbox(s.id, s.config.sandbox);
  }
}

// ---------- 状态事件（§3.2a） ----------

const baseStatus = shape({
  stageId: 'string:1-64',
  ready: 'enum:none,core,stage',
  runs: `integer:0-${COUNT_MAX}`,
  errors: `integer:0-${COUNT_MAX}`,
  lastError: 'optional:string:0-200',
  lastRunAt: 'optional:integer',
  tests: 'optional:object',
});
const testsShape = shape({
  passed: `integer:0-${COUNT_MAX}`,
  failed: `integer:0-${COUNT_MAX}`,
  errors: `integer:0-${COUNT_MAX}`,
  total: `integer:0-${COUNT_MAX}`,
});
export function statusShape(payload) {
  const p = baseStatus(payload);
  if (p.tests != null) {
    try {
      testsShape(p.tests);
    } catch (err) {
      throw new Error(`tests.${err.message}`);
    }
  }
  return p;
}

const keyShape = shape({ key: 'string:32-32' });

function registerKey(state, owner, key) {
  const list = (state.keys.get(owner) ?? []).filter((k) => k !== key);
  list.push(key);
  while (list.length > KEYS_PER_OWNER) list.shift();
  state.keys.set(owner, list);
}

export function register(cctx) {
  validateConfig(cctx.options, cctx.stages.list());
  const state = stateOf(cctx);

  cctx.on('sandbox:s-status', statusShape, (socket, payload, actor) => {
    const { stageId, ...rest } = payload;
    if (stageId !== cctx.state.currentStage) return cctx.reject(socket, '不是当前阶段');
    const entry = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) entry[k] = v;
    cctx.data.set(actor.name, { [stageId]: { ...entry, at: Date.now() } });
  });

  cctx.on('sandbox:s-stdin-key', keyShape, (socket, { key }, actor) => {
    if (!KEY_RE.test(key)) return cctx.reject(socket, 'invalid key');
    registerKey(state, actor.name, key);
  });

  cctx.on('sandbox:t-stdin-key', keyShape, (socket, { key }) => {
    if (!KEY_RE.test(key)) return cctx.reject(socket, 'invalid key');
    registerKey(state, TEACHER_KEY, key);
  });
}

// ---------- stdin 信箱路由（§3.2b） ----------

function isRegistered(state, key) {
  for (const list of state.keys.values()) if (list.includes(key)) return true;
  return false;
}

// deps（仅测试注入）：waitMs 挂起上限、ttlMs 信箱过期、now、maxEntries 总量、maxRunsPerKey 每 key 活跃 runId
export function http(router, cctx, deps = {}) {
  const {
    waitMs = 25_000, ttlMs = 30_000, now = Date.now, maxEntries = 2000, maxRunsPerKey = 5,
  } = deps;
  const state = stateOf(cctx);
  const boxes = state.boxes;

  const endPending = (entry, status, body) => {
    const res = entry.pending;
    if (!res) return;
    clearTimeout(entry.timer);
    entry.pending = undefined;
    entry.timer = undefined;
    if (res.writableEnded) return;
    res.setHeader('Cache-Control', 'no-store');
    if (status === 204) res.status(204).end();
    else res.status(status).json(body);
  };

  const dropEntry = (id) => {
    const entry = boxes.get(id);
    if (!entry) return;
    endPending(entry, 204);
    boxes.delete(id);
  };

  // 过期项在每次访问时顺带清理：没有挂起的 GET、信箱为空或已过期
  const sweep = () => {
    const t = now();
    for (const [id, e] of boxes) {
      if (e.pending) continue;
      if (!e.box || e.expiresAt <= t) boxes.delete(id);
    }
  };

  // 取或建 key/runId 项；建新项时先按 key 淘汰最旧，再查总量；超出返回 null（503）
  const obtain = (key, runId) => {
    const id = `${key}/${runId}`;
    const existing = boxes.get(id);
    if (existing) return existing;
    const mine = [];
    for (const k of boxes.keys()) if (k.startsWith(`${key}/`)) mine.push(k);
    while (mine.length >= maxRunsPerKey) dropEntry(mine.shift());
    if (boxes.size >= maxEntries) return null;
    const entry = { pending: undefined, timer: undefined, box: undefined, expiresAt: 0 };
    boxes.set(id, entry);
    return entry;
  };

  const checkParams = (req, res) => {
    const { key, runId } = req.params;
    if (!KEY_RE.test(key) || !RUN_ID_RE.test(runId)) {
      res.status(400).json({ error: 'bad key or runId' });
      return null;
    }
    if (!isRegistered(state, key)) {
      res.status(403).json({ error: 'key not registered' });
      return null;
    }
    return { key, runId: String(Number(runId)), id: `${key}/${Number(runId)}` };
  };

  router.get('/stdin/:key/:runId', (req, res) => {
    const p = checkParams(req, res);
    if (!p) return;
    sweep();
    const entry = obtain(p.key, p.runId);
    if (!entry) return res.status(503).json({ error: 'mailbox full' });
    res.setHeader('Cache-Control', 'no-store');
    if (entry.box) {
      const body = entry.box;
      boxes.delete(p.id);
      return res.status(200).json(body);
    }
    // 同一 key/runId 再来一个 GET：旧的以 204 结束，新的接替
    endPending(entry, 204);
    entry.pending = res;
    entry.timer = setTimeout(() => {
      if (entry.pending !== res) return;
      endPending(entry, 204);
      if (!entry.box && boxes.get(p.id) === entry) boxes.delete(p.id);
    }, waitMs);
    entry.timer.unref?.();
    // 断连检测用 res close（req close 在请求体读完后也会触发，会误删正常挂起的 GET）
    res.on('close', () => {
      if (res.writableEnded) return;
      if (entry.pending !== res) return;
      clearTimeout(entry.timer);
      entry.pending = undefined;
      entry.timer = undefined;
      if (!entry.box && boxes.get(p.id) === entry) boxes.delete(p.id);
    });
  });

  router.post('/stdin/:key/:runId', (req, res) => {
    const p = checkParams(req, res);
    if (!p) return;
    const b = req.body;
    let body;
    if (isPlainObject(b) && Object.keys(b).length === 1 && typeof b.line === 'string' && b.line.length <= 4096) body = { line: b.line };
    else if (isPlainObject(b) && Object.keys(b).length === 1 && b.eof === true) body = { eof: true };
    else return res.status(400).json({ error: 'body must be { line } or { eof: true }' });
    sweep();
    const entry = obtain(p.key, p.runId);
    if (!entry) return res.status(503).json({ error: 'mailbox full' });
    if (entry.pending) {
      endPending(entry, 200, body);
      boxes.delete(p.id);
    } else {
      entry.box = body;   // 只保留最新一条
      entry.expiresAt = now() + ttlMs;
    }
    res.status(200).json({});
  });
}
