// 原语的正文槽 options.prompt（P4）的校验：vote / quiz / free-text 共用。视图见 PromptText.jsx。
// 可缺省；写了就必须是 1–2000 字、不全是空白的字符串（可多行）。不是保密选项，学生能看到。
export const PROMPT_MAX = 2000;

export function validatePrompt(o) {
  if (!('prompt' in o) || o.prompt === undefined) return;
  const p = o.prompt;
  if (typeof p !== 'string' || p.trim() === '' || p.length > PROMPT_MAX) {
    throw new Error(`prompt 必须是 1–${PROMPT_MAX} 字的字符串（题目之外的正文 / 材料，可多行；不需要就不写 prompt）`);
  }
}
