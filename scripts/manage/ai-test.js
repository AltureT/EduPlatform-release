// 上课准备页"测一下"（K8，AI 备用线路规格 §5）：POST /api/ai/test { which: 1 | 2, baseUrl, model, apiKey? }
//   parseAITest(body, saved) → { env } | { error }：用表单里的地址、模型；密钥留空（或脱敏值）用 .env 里已保存的那组密钥
//   runAITest(env, { fetch, timeoutMs }) → { ok: true, ms } | { ok: false, reason, text }：建一个临时 createAI 实例，
//     发"只回复 ok / ping"（maxTokens 64、timeoutMs 15000；empty 的文案注明可忽略），text 是失败原因的中文（内核 aiReasonText）
//   只在教师点按钮时发一次请求；不改 .env，与平台是否运行无关
import { createAI, AIError, aiReasonText } from '../../kernel/server/ai.js';
import { MASK } from './env-file.js';

export const AI_TEST_MESSAGES = Object.freeze([
  Object.freeze({ role: 'system', content: '只回复 ok' }),
  Object.freeze({ role: 'user', content: 'ping' }),
]);
export const AI_TEST_TIMEOUT_MS = 15000;
// 审查：5 太少，带思考过程的模型常常一个字都还没回就用完了
export const AI_TEST_MAX_TOKENS = 64;
// 审查：empty 多半不是接口坏了（思考模型把 token 用在思考上），提示可忽略
const EMPTY_TEXT = '回复为空（带思考过程的模型也可能这样，可忽略）';
const MAX_LEN = 2000;
const quiet = { info() {}, warn() {}, error() {} };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const bad = (v) => v.length > MAX_LEN || /[\r\n]/.test(v);

export function parseAITest(body, saved = {}) {
  if (!isPlainObject(body) || (body.which !== 1 && body.which !== 2)) return { error: '参数不对' };
  const baseUrl = text(body.baseUrl);
  const model = text(body.model);
  if (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== 'string') return { error: '参数不对' };
  const typed = text(body.apiKey);
  if (bad(baseUrl) || bad(model) || bad(typed)) return { error: '参数不对' };
  if (!baseUrl) return { error: '先填接口地址' };
  if (!/^https?:\/\//i.test(baseUrl)) return { error: '地址须以 http:// 或 https:// 开头' };
  if (!model) return { error: '先填模型名' };
  const keyName = body.which === 2 ? 'AI_API_KEY_2' : 'AI_API_KEY';
  const key = typed && !typed.startsWith(MASK) ? typed : text(saved?.[keyName]);
  return { env: { AI_BASE_URL: baseUrl, AI_MODEL: model, AI_API_KEY: key } };
}

export async function runAITest(env, { fetch: fetchFn = globalThis.fetch, timeoutMs = AI_TEST_TIMEOUT_MS } = {}) {
  const ai = createAI({ env, fetch: fetchFn, log: quiet });
  try {
    const r = await ai.chat(AI_TEST_MESSAGES.map((m) => ({ ...m })), { maxTokens: AI_TEST_MAX_TOKENS, timeoutMs, caller: 'manage:test' });
    return { ok: true, ms: r.ms };
  } catch (err) {
    const reason = err instanceof AIError ? err.reason : 'network';
    return { ok: false, reason, text: reason === 'empty' ? EMPTY_TEXT : aiReasonText(reason) };
  }
}
