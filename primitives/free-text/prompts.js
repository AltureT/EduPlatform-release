// free-text 原语内部的纯函数（服务端、配置与视图共用；无 Node / 浏览器依赖）

export const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const MAX_LIMIT = 5000;

// 字数：去首尾空白后按字符（码点）计，一个汉字、一个 emoji 都算 1
export function countChars(s) {
  return typeof s === 'string' ? [...s.trim()].length : 0;
}

// 首句预览：取第一个句末标点（。！？!?）或换行之前的部分，超过 limit 字截断加"…"
export function firstSentence(s, limit = 24) {
  const t = typeof s === 'string' ? s.trim() : '';
  if (!t) return '';
  const m = /^[^\n。！？!?]*[。！？!?]?/.exec(t);
  const head = (m ? m[0] : t).trim() || t;
  const chars = [...head];
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : head;
}

// 一份作答的字数校验（按 options.prompts 顺序，遇到第一个问题即返回）→ { answers }（去首尾空白）或 { error }
export function checkLengths(options, answers) {
  const out = {};
  for (const p of options.prompts) out[p.id] = typeof answers?.[p.id] === 'string' ? answers[p.id].trim() : '';
  if (options.prompts.every((p) => out[p.id] === '')) return { error: '还没有写任何内容' };
  for (const [i, p] of options.prompts.entries()) {
    const n = countChars(out[p.id]);
    if (n > p.max) return { error: `第 ${i + 1} 题超出字数上限（已写 ${n} 字，最多 ${p.max} 字）` };
    if (n < p.min) return { error: `第 ${i + 1} 题至少 ${p.min} 字（已写 ${n} 字）` };
  }
  return { answers: out };
}
