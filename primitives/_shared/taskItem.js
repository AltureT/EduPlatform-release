// code 的 requirements 与 data-analysis 的 tasks 共用的条目写法（代码段教学功能规格 §3，P6）。只给原语作者用；无 Node / 浏览器依赖。
//   条目：1–200 字的字符串，或 { text: 1–200 字, hint?: 1–hintMax 字的代码片段 }（hint 可写 { from }，加载器已读成文本）
//   validateTaskItem(field, t, i, hintMax)：不合法抛中文错误（field 为 'requirements' / 'tasks'）
//   taskText(t) / taskHint(t)：视图与 coach 取条目文字 / 提示（没有提示为 null）
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateTaskItem(field, t, i, hintMax) {
  if (typeof t === 'string') {
    if (t.trim() === '' || t.length > 200) throw new Error(`${field}[${i}] 必须是 1–200 字`);
    return;
  }
  if (!isPlainObject(t)) throw new Error(`${field}[${i}] 必须是字符串或 { text, hint }`);
  const extra = Object.keys(t).filter((k) => k !== 'text' && k !== 'hint');
  if (extra.length > 0) throw new Error(`${field}[${i}] 不认识的键 ${extra.join(', ')}（可用：text、hint）`);
  if (typeof t.text !== 'string' || t.text.trim() === '' || t.text.length > 200) throw new Error(`${field}[${i}].text 必须是 1–200 字`);
  if (t.hint !== undefined && (typeof t.hint !== 'string' || t.hint.trim() === '' || t.hint.length > hintMax)) {
    throw new Error(`${field}[${i}].hint 必须是 1–${hintMax} 字的代码片段`);
  }
}

export const taskText = (t) => (typeof t === 'string' ? t : t?.text ?? '');
export const taskHint = (t) => (isPlainObject(t) && typeof t.hint === 'string' ? t.hint : null);
