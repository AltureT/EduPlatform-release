// 统一 AI 接口（K6，统一 AI 接口规格 §2；契约 §三"调 AI"）
// createAI({ env = process.env, fetch = globalThis.fetch, log, limits }) → ai
//   ai.configured：AI_BASE_URL 与 AI_MODEL 都非空；ai.reason：null | '未配置'
//   await ai.chat(messages, { temperature = 0.2, maxTokens = 400, timeoutMs = 25000, caller }) → { content, ms }
//   失败抛 AIError(reason)，reason ∈ 'not-configured' | 'timeout' | 'http-<status>' | 'network' | 'empty' | 'crowded' | 'too-long'
// OpenAI 兼容 chat/completions，原生 fetch，一次不重试；超时 = AbortController + Promise.race 兜底
// 全局并发：同时在途 ≤ limits.maxActive（8），排队 ≤ limits.maxQueue（20），再多立刻抛 crowded（不等待）；
//   limits 各项须为正整数（timeoutMs ≤ 2^31-1），不合法用缺省；超时从拿到名额起算，排队时间不计；
//   课堂重置不清队列（重置前发出的请求由调用方按自己的 generation 丢弃结果）
// 日志：log.info('ai', { caller, status: 'ok' | reason, ms })；不记 messages、content、密钥、地址
// 同一进程只建一个实例（app.js 创建，传给阶段与组件上下文）；测试用 createAI({ env, fetch }) 注入假 fetch
import { createLog } from './log.js';

export class AIError extends Error {
  constructor(reason) {
    super(`ai: ${reason}`);
    this.name = 'AIError';
    this.reason = reason;
  }
}

export const AI_LIMITS = Object.freeze({ maxActive: 8, maxQueue: 20, maxMessages: 12, maxChars: 12000, timeoutMs: 25000 });
const ROLES = new Set(['system', 'user', 'assistant']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const posInt = (v, d, max = Number.MAX_SAFE_INTEGER) => (Number.isInteger(v) && v > 0 && v <= max ? v : d);
// setTimeout 的上限（更大的值 Node 会当成 1 ms）
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// limits 逐项校验：只认 AI_LIMITS 的五个键，必须是正整数（timeoutMs ≤ 2^31-1），不合法用缺省
export function normalizeLimits(limits) {
  const src = isPlainObject(limits) ? limits : {};
  const out = {};
  for (const [k, d] of Object.entries(AI_LIMITS)) out[k] = posInt(src[k], d, k === 'timeoutMs' ? MAX_TIMEOUT_MS : undefined);
  return out;
}

export function aiConfigured(env) {
  return str(env?.AI_BASE_URL) !== '' && str(env?.AI_MODEL) !== '';
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

export function createAI({ env = process.env, fetch: fetchFn = globalThis.fetch, log = createLog('kernel'), limits } = {}) {
  const lim = normalizeLimits(limits);
  const configured = aiConfigured(env);
  const base = str(env?.AI_BASE_URL).replace(/\/+$/, '');
  const model = str(env?.AI_MODEL);
  const key = str(env?.AI_API_KEY);
  const url = `${base}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

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

  // 一次请求：fetch + 读 JSON；signal 中止时按 timeout 算
  async function request(body, signal, started) {
    let res;
    try {
      res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
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
    return { content: content.trim(), ms: Date.now() - started };
  }

  // 超时两层：到点 abort（fetch 理会 signal 时立即结束），同时 Promise.race 定时兜底（fetch 不理会 signal 也能结束）
  async function send(body, timeoutMs) {
    const started = Date.now();
    const ctrl = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new AIError('timeout'));
      }, timeoutMs);
      timer.unref?.();
    });
    const req = request(body, ctrl.signal, started);
    req.catch(() => {});   // 输给定时兜底后再失败的请求不成为未处理的拒绝
    try {
      return await Promise.race([req, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function chat(messages, opts = {}) {
    const o = isPlainObject(opts) ? opts : {};
    const caller = typeof o.caller === 'string' && o.caller ? o.caller : 'unknown';
    const started = Date.now();
    const done = (status, ms = Date.now() - started) => {
      try {
        log?.info?.('ai', { caller, status, ms });
      } catch {
        // 日志失败不影响调用
      }
    };
    try {
      if (!configured) throw new AIError('not-configured');
      checkMessages(messages, lim);
    } catch (err) {
      if (err instanceof AIError) done(err.reason);
      throw err;
    }
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: finite(o.temperature, 0.2),
      max_tokens: posInt(o.maxTokens, 400),
    };
    try {
      await acquire();
    } catch (err) {
      done(err.reason);
      throw err;
    }
    try {
      const r = await send(body, posInt(o.timeoutMs, lim.timeoutMs, MAX_TIMEOUT_MS));
      done('ok', r.ms);
      return r;
    } catch (err) {
      done(err instanceof AIError ? err.reason : 'network');
      throw err instanceof AIError ? err : new AIError('network');
    } finally {
      release();
    }
  }

  return Object.freeze({ configured, reason: configured ? null : '未配置', chat });
}
