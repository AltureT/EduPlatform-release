// 上课准备页"获取模型"（K9，AI 备用线路规格 §5.1）：POST /api/ai/models { which: 1 | 2, baseUrl, apiKey? }
//   parseAIModels(body, saved) → { baseUrl, apiKey } | { error }：地址用表单值；密钥留空（或脱敏值）用 .env 里该组已保存的
//   fetchModels({ baseUrl, apiKey, fetch, timeoutMs }) → { ok: true, models: [id…] } | { ok: false, reason, text }：
//     GET <地址去尾斜杠>/models（Bearer 同"测一下"，超时 15 s）；解析 OpenAI 格式 { data: [{ id }] }
//   parseModels(json) → [id…] | null：id 为非空字符串的项，去重、按字母排序、最多 AI_MODELS_MAX 个；不是 { data: [] } 形状 → null
//   reason 与 text 沿用"测一下"的中文表（内核 aiReasonText），另加 http-404 / empty 两条；空列表、非 JSON、无 data → empty
//   只在教师点按钮时发一次请求；不改 .env，结果不回显密钥
import { aiReasonText } from '../../kernel/server/ai.js';
import { MASK } from './env-file.js';

export const AI_MODELS_TIMEOUT_MS = 15000;
export const AI_MODELS_MAX = 500;
const MODELS_TEXT = Object.freeze({
  'http-404': '这个地址不支持列模型，请手动填模型名',
  empty: '没有返回模型列表，请手动填模型名',
});
const MAX_LEN = 2000;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const bad = (v) => v.length > MAX_LEN || /[\r\n]/.test(v);

class Fail extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export function aiModelsReasonText(reason) {
  return MODELS_TEXT[reason] ?? aiReasonText(reason);
}

export function parseModels(json) {
  if (!isPlainObject(json) || !Array.isArray(json.data)) return null;
  const ids = new Set();
  for (const item of json.data) {
    const id = isPlainObject(item) ? text(item.id) : '';
    if (id) ids.add(id);
  }
  return [...ids].sort().slice(0, AI_MODELS_MAX);
}

export function parseAIModels(body, saved = {}) {
  if (!isPlainObject(body) || (body.which !== 1 && body.which !== 2)) return { error: '参数不对' };
  if (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== 'string') return { error: '参数不对' };
  const baseUrl = text(body.baseUrl);
  const typed = text(body.apiKey);
  if (bad(baseUrl) || bad(typed)) return { error: '参数不对' };
  if (!baseUrl) return { error: '先填接口地址' };
  if (!/^https?:\/\//i.test(baseUrl)) return { error: '地址须以 http:// 或 https:// 开头' };
  const keyName = body.which === 2 ? 'AI_API_KEY_2' : 'AI_API_KEY';
  const apiKey = typed && !typed.startsWith(MASK) ? typed : text(saved?.[keyName]);
  return { baseUrl, apiKey };
}

async function request(url, headers, fetchFn, signal) {
  let res;
  try {
    res = await fetchFn(url, { method: 'GET', headers, signal, redirect: 'error' });   // 不跟随跳转：密钥只发往这个地址
  } catch (err) {
    throw new Fail(signal.aborted || err?.name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!res || !res.ok) throw new Fail(`http-${res?.status ?? 0}`);
  let json;
  try {
    json = await res.json();
  } catch (err) {
    if (signal.aborted || err?.name === 'AbortError') throw new Fail('timeout');
    throw new Fail('empty');
  }
  const models = parseModels(json);
  if (!models || models.length === 0) throw new Fail('empty');
  return models;
}

export async function fetchModels({ baseUrl, apiKey = '', fetch: fetchFn = globalThis.fetch, timeoutMs = AI_MODELS_TIMEOUT_MS } = {}) {
  const url = `${text(baseUrl).replace(/\/+$/, '')}/models`;
  const headers = {};
  const key = text(apiKey);
  if (key) headers.Authorization = `Bearer ${key}`;
  // 超时两层（同内核 ai.js）：到点 abort，同时 Promise.race 兜底（fetch 不理会 signal 也能结束）
  const ctrl = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Fail('timeout'));
    }, timeoutMs);
    timer.unref?.();
  });
  const req = request(url, headers, fetchFn, ctrl.signal);
  req.catch(() => {});
  try {
    return { ok: true, models: await Promise.race([req, deadline]) };
  } catch (err) {
    const reason = err instanceof Fail ? err.reason : 'network';
    return { ok: false, reason, text: aiModelsReasonText(reason) };
  } finally {
    clearTimeout(timer);
  }
}
