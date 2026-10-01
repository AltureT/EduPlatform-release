// 统一 AI 接口（K6，统一 AI 接口规格 §2；契约 §三"调 AI"）；K8 备用线路（AI 备用线路规格 §3）
// createAI({ env = process.env, fetch = globalThis.fetch, log, limits, cooldownMs = 60000 }) → ai
//   两组接口：第一组 AI_BASE_URL / AI_API_KEY / AI_MODEL，第二组 AI_BASE_URL_2 / AI_API_KEY_2 / AI_MODEL_2；
//   一组"已配置" = 地址与模型都非空（密钥可空）
//   ai.configured：任一组已配置；ai.reason：null | '未配置'
//   ai.routes：[{ route: 1, configured }, { route: 2, configured }]（只读，不含地址、密钥）
//   ai.status() → { configured, active: 1 | 2 | null, routes: [{ route, configured, down, since?, lastError? }] }
//   await ai.chat(messages, { temperature = 0.2, maxTokens = 400, timeoutMs = 25000, caller }) → { content, ms, route }
//   失败抛 AIError(reason)，reason ∈ 'not-configured' | 'timeout' | 'http-<status>' | 'network' | 'empty' | 'crowded' | 'too-long'
// OpenAI 兼容 chat/completions，原生 fetch；超时 = AbortController + Promise.race 兜底
// 切换：先按优先线路发；失败原因可切换（timeout / network / empty / http-5xx / 429 / 401 / 403 / 404）且另一条已配置
//   → 同一份 messages、同样 timeoutMs、同一个并发名额，用另一条再发一次；两条都失败抛第一条的错误。
//   失败的线路标 down（since = 首次不可用的时刻，lastError = reason），冷却 cooldownMs 后下一次请求先试它（探测；决定探测时即把冷却推后一轮，同一时刻只有一个请求探测），
//   成功清 down、优先线路回到它；两条都 down 时按原顺序（1 再 2）试。ms 是总耗时（含失败那次）。
// 全局并发：同时在途 ≤ limits.maxActive（8），排队 ≤ limits.maxQueue（20），再多立刻抛 crowded（不等待）；
//   limits 各项须为正整数（timeoutMs ≤ 2^31-1），不合法用缺省；超时从拿到名额起算，排队时间不计；
//   课堂重置不清队列（重置前发出的请求由调用方按自己的 generation 丢弃结果）
// 日志：log.info('ai', { caller, status: 'ok' | reason, ms, route })（每次发送一条；没发出去 route 为 null）；
//   线路从正常变 down 并改用另一条时 log.warn('ai-failover', { from, to, reason })（并发同时失败只记一次，探测失败不记），恢复 log.info('ai-recover', { route })；不记 messages、content、密钥、地址
// 同一进程只建一个实例（app.js 创建，传给阶段与组件上下文）；测试用 createAI({ env, fetch }) 注入假 fetch
import { createLog } from './log.js';

export class AIError extends Error {
  constructor(reason) {
    super(`ai: ${reason}`);
    this.name = 'AIError';
    this.reason = reason;
  }
}

// maxChars：一次 messages 合计码点上限（C4，AI 助手上下文规格 §4：12000 → 20000，coach 自己保证 ≤ 16000）
export const AI_LIMITS = Object.freeze({ maxActive: 8, maxQueue: 20, maxMessages: 12, maxChars: 20000, timeoutMs: 25000 });
export const AI_COOLDOWN_MS = 60000;
const ROLES = new Set(['system', 'user', 'assistant']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const posInt = (v, d, max = Number.MAX_SAFE_INTEGER) => (Number.isInteger(v) && v > 0 && v <= max ? v : d);
// setTimeout 的上限（更大的值 Node 会当成 1 ms）
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// 可切换到另一条线路的失败原因（AI 备用线路规格 §3.2）；http-400 / crowded / too-long / not-configured 不切换
export function isSwitchable(reason) {
  if (['timeout', 'network', 'empty', 'http-429', 'http-401', 'http-403', 'http-404'].includes(reason)) return true;
  return /^http-5\d\d$/.test(String(reason));
}

// 失败原因的中文（AI 备用线路规格 §4：coach 教师端提示、工作台"测一下"）；coach client.jsx 的 REASON_TEXT 与此一致（有单测）
export const AI_REASON_TEXT = Object.freeze({
  timeout: '超时',
  network: '连不上',
  'http-401': '密钥不对',
  'http-403': '密钥不对',
  'http-404': '地址或模型名不对',
  'http-429': '太频繁',
  'http-5xx': '服务商故障',
  empty: '回复为空',
});
export function aiReasonText(reason) {
  if (typeof reason !== 'string' || reason === '') return '出错了';
  if (/^http-5\d\d$/.test(reason)) return AI_REASON_TEXT['http-5xx'];
  return AI_REASON_TEXT[reason] ?? `出错了（${reason}）`;
}

// limits 逐项校验：只认 AI_LIMITS 的五个键，必须是正整数（timeoutMs ≤ 2^31-1），不合法用缺省
export function normalizeLimits(limits) {
  const src = isPlainObject(limits) ? limits : {};
  const out = {};
  for (const [k, d] of Object.entries(AI_LIMITS)) out[k] = posInt(src[k], d, k === 'timeoutMs' ? MAX_TIMEOUT_MS : undefined);
  return out;
}

// 一组接口的配置；suffix '' 为第一组，'_2' 为第二组
function routeConfig(env, suffix) {
  const base = str(env?.[`AI_BASE_URL${suffix}`]).replace(/\/+$/, '');
  const model = str(env?.[`AI_MODEL${suffix}`]);
  const key = str(env?.[`AI_API_KEY${suffix}`]);
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  return { configured: base !== '' && model !== '', url: `${base}/chat/completions`, model, headers };
}

// 任一组已配置即 true
export function aiConfigured(env) {
  return routeConfig(env, '').configured || routeConfig(env, '_2').configured;
}

// 形状不对是写代码的错（抛普通 TypeError）；条数超过上限或字数超限 → too-long（不发请求）
function checkMessages(messages, { maxMessages, maxChars }) {
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError('ai.chat: messages must be a non-empty array');
  let total = 0;
  for (const m of messages) {
    if (!isPlainObject(m) || !ROLES.has(m.role) || typeof m.content !== 'string') {
      throw new TypeError('ai.chat: each message must be { role: system|user|assistant, content: string }');
    }
    total += Array.from(m.content).length;
  }
  if (messages.length > maxMessages || total > maxChars) throw new AIError('too-long');
}

// 缺省实例（没注入 ai 的上下文、测试工具）：未配置，chat 抛 not-configured，永远不发请求
export const unconfiguredAI = (log) => createAI({ env: {}, fetch: null, ...(log ? { log } : {}) });

export function createAI({
  env = process.env, fetch: fetchFn = globalThis.fetch, log = createLog('kernel'), limits, cooldownMs,
} = {}) {
  const lim = normalizeLimits(limits);
  const cooldown = posInt(cooldownMs, AI_COOLDOWN_MS, MAX_TIMEOUT_MS);
  const cfg = { 1: routeConfig(env, ''), 2: routeConfig(env, '_2') };
  const configured = cfg[1].configured || cfg[2].configured;
  // 线路状态：down 时 since（首次不可用）、lastError（reason）、retryAt（冷却结束，可探测）
  const state = { 1: { down: false }, 2: { down: false } };
  let preferred = cfg[1].configured ? 1 : cfg[2].configured ? 2 : null;
  const safeLog = (level, msg, extra) => {
    try {
      log?.[level]?.(msg, extra);
    } catch {
      // 日志失败不影响调用
    }
  };
  if (!cfg[1].configured && cfg[2].configured) safeLog('warn', '只配置了备用接口，当作唯一线路');

  const routes = Object.freeze([1, 2].map((route) => Object.freeze({ route, configured: cfg[route].configured })));

  let active = 0;
  const queue = [];
  const acquire = () => {
    if (active < lim.maxActive) {
      active++;
      return Promise.resolve();
    }
    if (queue.length >= lim.maxQueue) return Promise.reject(new AIError('crowded'));
    return new Promise((resolve) => queue.push(resolve));
  };
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active = Math.max(0, active - 1);
  };

  // 本次请求依次试哪几条线路
  function order(now) {
    const avail = [1, 2].filter((r) => cfg[r].configured);
    if (avail.length < 2) return avail;
    if (state[1].down && state[2].down) return [1, 2];
    const other = preferred === 1 ? 2 : 1;
    // 冷却结束的 down 线路先探测；决定探测的这一刻就把它的冷却推后一轮，同时到达的其它请求不再探测、直接走健康线路
    if (state[other].down && now >= state[other].retryAt) {
      state[other].retryAt = now + cooldown;
      return [other, preferred];
    }
    return [preferred, other];
  }

  // 返回 true = 这条线路刚从正常变 down（ai-failover 只在这时记，并发同时失败不重复记）
  function markDown(route, reason) {
    const s = state[route];
    const now = Date.now();
    const fresh = !s.down;
    if (fresh) {
      s.down = true;
      s.since = now;
    }
    s.lastError = reason;
    s.retryAt = now + cooldown;
    return fresh;
  }

  function markUp(route) {
    if (state[route].down) {
      state[route] = { down: false };
      safeLog('info', 'ai-recover', { route });
    }
    preferred = route;
  }

  // 一次请求：fetch + 读 JSON；signal 中止时按 timeout 算
  async function request(c, body, signal) {
    let res;
    try {
      res = await fetchFn(c.url, { method: 'POST', headers: c.headers, body: JSON.stringify(body), signal });
    } catch (err) {
      throw new AIError(signal.aborted || err?.name === 'AbortError' ? 'timeout' : 'network');
    }
    if (!res || !res.ok) throw new AIError(`http-${res?.status ?? 0}`);
    let data;
    try {
      data = await res.json();
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') throw new AIError('timeout');
      throw new AIError('empty');
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') throw new AIError('empty');
    return content.trim();
  }

  // 超时两层：到点 abort（fetch 理会 signal 时立即结束），同时 Promise.race 定时兜底（fetch 不理会 signal 也能结束）
  async function send(c, body, timeoutMs) {
    const ctrl = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new AIError('timeout'));
      }, timeoutMs);
      timer.unref?.();
    });
    const req = request(c, body, ctrl.signal);
    req.catch(() => {});   // 输给定时兜底后再失败的请求不成为未处理的拒绝
    try {
      return await Promise.race([req, deadline]);
    } catch (err) {
      throw err instanceof AIError ? err : new AIError('network');
    } finally {
      clearTimeout(timer);
    }
  }

  async function chat(messages, opts = {}) {
    const o = isPlainObject(opts) ? opts : {};
    const caller = typeof o.caller === 'string' && o.caller ? o.caller : 'unknown';
    const t0 = Date.now();
    const done = (status, route, since = t0) => safeLog('info', 'ai', { caller, status, ms: Date.now() - since, route });
    try {
      if (!configured) throw new AIError('not-configured');
      checkMessages(messages, lim);
    } catch (err) {
      if (err instanceof AIError) done(err.reason, null);
      throw err;
    }
    const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
    const temperature = finite(o.temperature, 0.2);
    const maxTokens = posInt(o.maxTokens, 400);
    const timeoutMs = posInt(o.timeoutMs, lim.timeoutMs, MAX_TIMEOUT_MS);
    try {
      await acquire();
    } catch (err) {
      done(err.reason, null);
      throw err;
    }
    const started = Date.now();
    try {
      const tries = order(started);
      let firstErr = null;
      for (let i = 0; i < tries.length; i++) {
        const route = tries[i];
        const body = { model: cfg[route].model, messages: msgs, temperature, max_tokens: maxTokens };
        try {
          const content = await send(cfg[route], body, timeoutMs);
          const ms = Date.now() - started;
          done('ok', route, started);
          markUp(route);
          return { content, ms, route };
        } catch (err) {
          done(err.reason, route, started);
          if (!firstErr) firstErr = err;
          if (!isSwitchable(err.reason)) throw firstErr;
          const fresh = markDown(route, err.reason);
          const next = tries[i + 1];
          if (next && fresh) safeLog('warn', 'ai-failover', { from: route, to: next, reason: err.reason });
        }
      }
      throw firstErr;
    } finally {
      release();
    }
  }

  function status() {
    return {
      configured,
      active: configured ? preferred : null,
      routes: [1, 2].map((route) => {
        const s = state[route];
        const r = { route, configured: cfg[route].configured, down: s.down };
        if (s.down) {
          r.since = s.since;
          r.lastError = s.lastError;
        }
        return r;
      }),
    };
  }

  return Object.freeze({ configured, reason: configured ? null : '未配置', routes, status, chat });
}
