// code 原语的错误库（代码题批改规格 §4.3）：纯函数，配置、服务端、统计视图共用（无 Node / 浏览器依赖）
//   options.mistakes = mistakes.json（npm run prep:tests 生成）：{ version: 1, cases: [用例名], mistakes: [{ id, label, hint, failing: [用例名] }] }
//   parseMistakes(value) → 规整后的对象（文本先 JSON.parse；形状不对抛中文错误）
//   matchMistake(cases, mistakes) → { id, label } | null：cases 是记录 tests.cases（[{ name, ok }]），失败集合 F = ok 为 false 的 name；
//     F 为空或没有 cases → null；对每个模式 P 算 Jaccard |F∩P| / |F∪P|，取最大者，≥ MATCH_MIN 才算匹配，并列取先出现的
//   mistakeOf(mistakes, id) → { id, label, hint, failing } | null
// 报错信息里不写具体的示例路径（前端打包含本文件）。
export const MATCH_MIN = 0.75;
export const MISTAKES_MAX = 8;
const LABEL_MAX = 20;
const HINT_MAX = 200;
const NAME_MAX = 200;
const CASES_MAX = 50;
const ID_RE = /^[a-z0-9_-]{1,32}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const len = (s) => Array.from(s).length;
const isName = (s) => typeof s === 'string' && s !== '' && len(s) <= NAME_MAX;

export function parseMistakes(value) {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw new Error('mistakes 不是合法的 JSON（它由 npm run prep:tests 生成，不要手改）');
    }
  }
  const bad = (why) => new Error(`mistakes 形状不对：${why}（重跑 npm run prep:tests 生成）`);
  if (!isPlainObject(v)) throw bad('应是 { version, cases, mistakes }');
  if (v.version !== 1) throw bad('version 应为 1');
  if (!Array.isArray(v.cases) || v.cases.length > CASES_MAX || !v.cases.every(isName)) throw bad(`cases 应是用例名数组（≤ ${CASES_MAX} 条）`);
  if (!Array.isArray(v.mistakes) || v.mistakes.length > MISTAKES_MAX) throw bad(`mistakes 应是数组（≤ ${MISTAKES_MAX} 个）`);
  const ids = new Set();
  const list = v.mistakes.map((m, i) => {
    const at = `mistakes[${i}]`;
    if (!isPlainObject(m)) throw bad(`${at} 应是 { id, label, hint, failing }`);
    if (typeof m.id !== 'string' || !ID_RE.test(m.id) || ids.has(m.id)) throw bad(`${at}.id 不合法或重复`);
    ids.add(m.id);
    if (typeof m.label !== 'string' || m.label.trim() === '' || len(m.label) > LABEL_MAX) throw bad(`${at}.label 应是 1–${LABEL_MAX} 字`);
    const hint = m.hint ?? '';
    if (typeof hint !== 'string' || len(hint) > HINT_MAX) throw bad(`${at}.hint 应是 ≤ ${HINT_MAX} 字`);
    if (!Array.isArray(m.failing) || !m.failing.every(isName)) throw bad(`${at}.failing 应是用例名数组`);
    return { id: m.id, label: m.label, hint, failing: [...m.failing] };
  });
  return { version: 1, cases: [...v.cases], mistakes: list };
}

const listOf = (mistakes) => {
  if (Array.isArray(mistakes)) return mistakes;
  return isPlainObject(mistakes) && Array.isArray(mistakes.mistakes) ? mistakes.mistakes : [];
};

export function matchMistake(cases, mistakes) {
  if (!Array.isArray(cases)) return null;
  const F = new Set(cases.filter((c) => isPlainObject(c) && c.ok === false && typeof c.name === 'string').map((c) => c.name));
  if (F.size === 0) return null;
  let best = null;
  let bestScore = -1;
  for (const m of listOf(mistakes)) {
    if (!isPlainObject(m) || !Array.isArray(m.failing)) continue;
    const P = new Set(m.failing);
    let inter = 0;
    for (const n of F) if (P.has(n)) inter += 1;
    const union = F.size + P.size - inter;
    const score = union > 0 ? inter / union : 0;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best && bestScore >= MATCH_MIN ? { id: best.id, label: best.label } : null;
}

export function mistakeOf(mistakes, id) {
  if (typeof id !== 'string') return null;
  return listOf(mistakes).find((m) => isPlainObject(m) && m.id === id) ?? null;
}
