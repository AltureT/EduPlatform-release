// vote 原语内部的纯函数（服务端、配置与视图共用；无 Node / 浏览器依赖）
// options 为校验后的对象：choices = [{ key, text }]，answer = 键数组或缺省

export const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// record.choice（单选为键、多选为键数组）→ 键数组
export function toKeys(choice) {
  if (choice == null) return [];
  return Array.isArray(choice) ? choice : [choice];
}

// 键数组按选项顺序排列并去重，只保留存在的键
export function orderKeys(options, keys) {
  const set = new Set(keys);
  return options.choices.map((c) => c.key).filter((k) => set.has(k));
}

export function choiceText(options, key) {
  const c = options.choices.find((x) => x.key === key);
  return c ? `${c.key}（${c.text}）` : key;
}

// 一个选择 → "C（29）" 或 "A（21）、C（29）"；未作答 → "未作答"
export function formatChoice(options, choice) {
  const keys = toKeys(choice);
  if (keys.length === 0) return '未作答';
  return orderKeys(options, keys).map((k) => choiceText(options, k)).join('、');
}

export function isCorrect(options, choice) {
  if (!Array.isArray(options.answer)) return null;
  const keys = orderKeys(options, toKeys(choice));
  return keys.length === options.answer.length && keys.every((k, i) => k === options.answer[i]);
}

// { [key]: 人数 }（多选时一人可计入多个选项）
export function countChoices(options, perStudent) {
  const counts = Object.fromEntries(options.choices.map((c) => [c.key, 0]));
  for (const r of Object.values(perStudent ?? {})) {
    for (const k of new Set(toKeys(r?.choice))) if (k in counts) counts[k] += 1;
  }
  return counts;
}

// 全班最多的选项（并列全部列出）；没人作答 → "—"
export function topChoices(options, perStudent) {
  const counts = countChoices(options, perStudent);
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return '—';
  return options.choices.filter((c) => counts[c.key] === max).map((c) => choiceText(options, c.key)).join('、');
}

// 选了某个选项的学生名（按 roster 顺序）
export function namesFor(options, key, roster, perStudent) {
  return (roster ?? []).filter((s) => toKeys(perStudent?.[s.name]?.choice).includes(key)).map((s) => s.name);
}
