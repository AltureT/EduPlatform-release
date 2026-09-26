// quiz 原语内部的纯函数（服务端、配置与视图共用；无 Node / 浏览器依赖）
// options 为校验后的对象：items = [{ id, type, question, choices? }]（公开），
// answerKey = { [id]: 'A' | true | ['2', '二'] }、explanations = { [id]: 文字 }（保密选项，学生端没有）

export const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const TYPES = ['single', 'truefalse', 'blank'];
export const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const BLANK_MAX = 100;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 填空比对：全角转半角（NFKC）、去首尾空白、不分大小写
export function normText(s) {
  return String(s).normalize('NFKC').trim().toLowerCase();
}

export function gradeOne(item, key, given) {
  if (given === undefined || given === null) return false;
  if (item.type === 'blank') {
    if (typeof given !== 'string') return false;
    const g = normText(given);
    return g !== '' && key.some((k) => normText(k) === g);
  }
  return given === key;
}

// → { score, total, results: { [id]: boolean } }；没有 answerKey（学生端 options）时 null
export function grade(options, answers) {
  if (!isPlainObject(options?.answerKey)) return null;
  const results = {};
  let score = 0;
  for (const item of options.items) {
    const ok = gradeOne(item, options.answerKey[item.id], answers?.[item.id]);
    results[item.id] = ok;
    if (ok) score += 1;
  }
  return { score, total: options.items.length, results };
}

// 一条记录的得分：有 answerKey 按答案现算，否则用记录里写好的 score / total（揭晓或提交后才有）；都没有 → null
export function scoreOf(options, record) {
  if (record?.submittedAt == null) return null;
  const g = grade(options, record.answers);
  if (g) return g;
  if (Number.isInteger(record.score) && Number.isInteger(record.total)) {
    return { score: record.score, total: record.total, results: record.results ?? null };
  }
  return null;
}

// 学生提交的 answers 校验与清理：键须为题目 id；single 为选项键、truefalse 为布尔、blank 为 ≤ 100 字的字符串；
// null / undefined / 空白填空视为未答（丢掉）。→ { answers } 或 { error }
export function checkAnswers(options, answers) {
  const out = {};
  const byId = new Map(options.items.map((it, i) => [it.id, { it, n: i + 1 }]));
  for (const [id, v] of Object.entries(answers ?? {})) {
    if (v === undefined) continue;
    const hit = byId.get(id);
    if (!hit) return { error: `没有题目 ${id}` };
    if (v === null) continue;
    const { it, n } = hit;
    if (it.type === 'single') {
      if (typeof v !== 'string' || !it.choices.some((c) => c.key === v)) return { error: `第 ${n} 题的答案必须是选项键（${it.choices.map((c) => c.key).join(' / ')}）` };
      out[id] = v;
    } else if (it.type === 'truefalse') {
      if (typeof v !== 'boolean') return { error: `第 ${n} 题的答案必须是 true / false` };
      out[id] = v;
    } else {
      if (typeof v !== 'string') return { error: `第 ${n} 题的答案必须是文字` };
      const t = v.trim();
      if (t.length > BLANK_MAX) return { error: `第 ${n} 题的答案最多 ${BLANK_MAX} 字` };
      if (t !== '') out[id] = t;
    }
  }
  return { answers: out };
}

export const isAnswered = (v) => v !== undefined && v !== null && v !== '';

// 一个作答 → 显示文字："C（29）" / "对" / "错" / 原文；未答 → "未作答"
export function formatAnswer(item, value) {
  if (!isAnswered(value)) return '未作答';
  if (item.type === 'single') {
    const c = item.choices.find((x) => x.key === value);
    return c ? `${c.key}（${c.text}）` : String(value);
  }
  if (item.type === 'truefalse') return value === true ? '对' : '错';
  return String(value);
}

// 正确答案 → 显示文字（填空多个可接受答案用" / "连接）
export function formatKey(item, key) {
  if (key === undefined) return '—';
  if (item.type === 'blank') return (Array.isArray(key) ? key : [key]).join(' / ');
  return formatAnswer(item, key);
}

export function median(nums) {
  const a = nums.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// 错题的题号（按 options.items 的顺序，1 起）
export function wrongNumbers(options, results) {
  if (!results) return [];
  return options.items.map((it, i) => (results[it.id] === true ? null : i + 1)).filter((n) => n != null);
}

export function formatNumbers(nums) {
  return nums.length === 0 ? '全对' : `第 ${nums.join('、')} 题`;
}

// 每题统计（教师端，有 answerKey）：{ [id]: { answered, correct, submitted, dist: { [显示值]: 人数 } } }
// submitted = 已提交人数（分母）；dist 按显示文字计数（填空按 normText 归并，显示第一次出现的写法）
export function itemStats(options, perStudent) {
  const records = Object.values(perStudent ?? {}).filter((r) => r?.submittedAt != null);
  const stats = {};
  for (const it of options.items) {
    const dist = new Map();
    let answered = 0;
    let correct = 0;
    for (const r of records) {
      const v = r.answers?.[it.id];
      if (!isAnswered(v)) continue;
      answered += 1;
      if (options.answerKey && gradeOne(it, options.answerKey[it.id], v)) correct += 1;
      const k = it.type === 'blank' ? normText(v) : String(v);
      const prev = dist.get(k);
      dist.set(k, { value: prev ? prev.value : v, count: (prev ? prev.count : 0) + 1 });
    }
    stats[it.id] = { answered, correct, submitted: records.length, dist: [...dist.values()] };
  }
  return stats;
}

export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// 已提交者的平均得分（能算出得分的记录）；没有 → null
export function averageScore(options, perStudent) {
  const scores = Object.values(perStudent ?? {}).map((r) => scoreOf(options, r)).filter(Boolean);
  if (scores.length === 0) return null;
  return scores.reduce((s, g) => s + g.score, 0) / scores.length;
}
