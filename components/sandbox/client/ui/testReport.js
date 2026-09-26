// 测试结果人话化（代码沙盒规格 §3.4，P3）：纯函数，无 Node / 浏览器依赖
// - caseLabel(name)：test_not_divisible_by_4 → "not divisible by 4"（去 test_ 前缀、下划线换空格）；参数化 test_param[1900-False] →
//   "param [1900-False]"；不是 test 开头的标识符原样
// - docstringsOf(tests)：{ 'test_x.py': 源码 } → { 函数名: docstring 首行 }（junit 里没有 docstring，只能从测试源码取）
// - failureReasons(stdout)：pytest -q 原文里每个失败用例一段（____ name ____ 起头，name 可带 [参数]，参数里可有 .），
//   取 ">" 标出的 assert 语句（多行 assert 拼完整，拼不完整加 …；没有 > 行退回第一条 assert）与 "E " 行 →
//   "assert is_leap(2023) is False → 实际 True"（E 行是 assert 比较时取左边；带消息的 assert 去掉 AssertionError: 前缀、
//   语句里去掉消息，消息放在括号里；E 行是别的异常时原样接在箭头后）
// - 收集错误（parseJunit 的用例名是模块路径，如 tests.test_main）显示为"测试文件加载失败"
// - enrichCases(t, tests)：给 TestResult.cases 每项加 label（docstring 优先）与 reason（失败时），原字段不动
// - reportCases(t)：→ 记录里的 cases [{ name, ok, reason }]（≤ 50 条，name ≤ 200 字、reason ≤ 200 字）；没有用例时 null
export const CASES_MAX = 50;
export const CASE_NAME_MAX = 200;
export const CASE_REASON_MAX = 200;

const clip = (s, n) => {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

// 用例名拆成函数名与参数段：test_param[1.5-False] → ['test_param', '[1.5-False]']
const splitParams = (name) => {
  const s = String(name ?? '');
  const i = s.indexOf('[');
  return i > 0 && s.endsWith(']') ? [s.slice(0, i), s.slice(i)] : [s, ''];
};

export const COLLECT_ERROR_LABEL = '测试文件加载失败';
// 收集错误：parseJunit 把它当成名字为模块路径（tests.test_main）的失败项——函数名部分含 "."
export const isCollectError = (name) => splitParams(name)[0].includes('.');

// 只处理 pytest 函数名的两种写法 test_xxx / testXxx（可带 [参数]）；已是显示名的（含空格、或 testing 这类普通词）原样返回，重复调用不变
export function caseLabel(name) {
  const [base, params] = splitParams(name);
  let rest = null;
  if (/^test_\w+$/.test(base)) rest = base.slice(5);
  else if (/^test[A-Z0-9]\w*$/.test(base)) rest = base.slice(4);
  if (rest == null) return String(name ?? '');
  const out = rest.replace(/_+/g, ' ').trim() || base;
  return params ? `${out} ${params}` : out;
}

// 只认"函数定义下一行就是三引号字符串"的写法；取第一行非空文字
export function docstringsOf(tests) {
  const out = {};
  if (!tests || typeof tests !== 'object') return out;
  const re = /^[ \t]*(?:async[ \t]+)?def[ \t]+(test\w*)[ \t]*\([^)]*\)[^:\n]*:[ \t]*\r?\n[ \t]+[rRuU]?("""|''')([\s\S]*?)\2/gm;
  for (const src of Object.values(tests)) {
    if (typeof src !== 'string') continue;
    for (const m of src.matchAll(re)) {
      const first = m[3].split('\n').map((l) => l.trim()).find(Boolean);
      if (first && !(m[1] in out)) out[m[1]] = first;
    }
  }
  return out;
}

const OPS = [' == ', ' != ', ' is not ', ' is ', ' not in ', ' in ', ' >= ', ' <= ', ' > ', ' < '];

// "assert True is False" → "True"；"assert False" → "False"；不是 assert 开头 → null
function actualOf(eText) {
  const m = /^assert\s+(.*)$/.exec(eText);
  if (!m) return null;
  const expr = m[1].trim();
  let cut = -1;
  for (const op of OPS) {
    const i = expr.indexOf(op);
    if (i > 0 && (cut < 0 || i < cut)) cut = i;
  }
  return (cut > 0 ? expr.slice(0, cut) : expr).trim() || null;
}

// stmt：assert 语句；eLines：该段所有 "E " 行（已去掉前缀）
export function reasonOf(stmt, eLines = []) {
  let s = stmt ? stmt.trim() : '';
  const es = (Array.isArray(eLines) ? eLines : [eLines]).map((x) => String(x ?? '').trim()).filter(Boolean);
  let msg = '';
  let e = es[0] ?? '';
  const m = /^AssertionError(?::\s*(.*))?$/.exec(e);
  if (m) {
    msg = (m[1] ?? '').trim();
    e = es.find((x) => /^assert\s/.test(x)) ?? '';
    // 语句里去掉消息部分：assert 条件, '消息'
    if (msg && s) {
      const at = s.lastIndexOf(msg);
      const comma = at > 0 ? s.lastIndexOf(',', at) : -1;
      if (comma > 0) s = s.slice(0, comma).trim();
    }
  }
  const tail = msg ? `（${msg}）` : '';
  if (s && e) {
    const actual = actualOf(e);
    return actual ? `${s} → 实际 ${actual}${tail}` : `${s} → ${e}${tail}`;
  }
  if (s && msg) return `${s} → ${msg}`;
  return s || e || msg;
}

// 括号是否配平（多行 assert 拼到配平为止）
const balanced = (text) => {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
  }
  return depth <= 0 && !quote;
};

// 从 lines[i]（assert 开头）起拼完整语句：后续缩进行（不是 E 行、不是空行、不以 > 开头）接上，直到括号配平；最多 12 行
function statementAt(lines, i, first) {
  let text = first;
  let j = i + 1;
  while (!balanced(text) && j < lines.length && j < i + 12) {
    const l = lines[j];
    if (!l.trim() || /^E\s/.test(l) || /^>/.test(l) || !/^\s/.test(l)) break;
    text += ` ${l.trim()}`;
    j += 1;
  }
  text = text.replace(/([([{])\s+/g, '$1').replace(/\s+([)\]}])/g, '$1');
  return balanced(text) ? text : `${text}…`;
}

// 段头里的用例名 → junit 用例名：去掉 "Class." / "file::" 前缀，参数段原样（参数里的 . 不切）
function headName(h) {
  let name = h.trim();
  const k = name.lastIndexOf('::');
  if (k >= 0) name = name.slice(k + 2);
  const [base, params] = splitParams(name);
  const segs = base.split('.').filter(Boolean);
  return `${segs[segs.length - 1] ?? base}${params}`;
}

// pytest -q 原文 → { 用例名: reason }；段头形如 "_____ test_x _____"、"_____ TestA.test_x _____"、"_____ test_p[1.5-a] _____"
export function failureReasons(stdout) {
  const out = {};
  const lines = String(stdout ?? '').split(/\r?\n/);
  let sec = null;   // { name, start, end }
  const secs = [];
  lines.forEach((line, i) => {
    const head = /^_{3,}\s+(.+?)\s+_{3,}\s*$/.exec(line);
    if (head || /^={3,}/.test(line)) {
      if (sec) secs.push({ ...sec, end: i });
      sec = head ? { name: headName(head[1]), start: i + 1 } : null;
    }
  });
  if (sec) secs.push({ ...sec, end: lines.length });
  for (const { name, start, end } of secs) {
    if (name in out) continue;
    let stmt = null;
    for (let i = start; i < end && stmt == null; i++) {
      const a = /^>\s*(assert\b.*)$/.exec(lines[i]);
      if (a) stmt = statementAt(lines, i, a[1].trim());
    }
    for (let i = start; i < end && stmt == null; i++) {
      const a = /^\s*(assert\b.*)$/.exec(lines[i]);
      if (a) stmt = statementAt(lines, i, a[1].trim());
    }
    const eLines = [];
    for (let i = start; i < end; i++) {
      const e = /^E\s+(.*)$/.exec(lines[i]);
      if (e && e[1].trim()) eLines.push(e[1].trim());
    }
    const r = reasonOf(stmt, eLines);
    if (r) out[name] = r;
  }
  return out;
}

// TestResult → 同形对象，cases 每项多 label / reason；没有 cases 原样返回
export function enrichCases(t, tests) {
  if (!t || !Array.isArray(t.cases) || t.cases.length === 0) return t;
  const docs = docstringsOf(tests);
  const reasons = failureReasons(t.stdout);
  const cases = t.cases.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const raw = String(c.name ?? '');
    const [base, params] = splitParams(raw);
    const doc = docs[base];
    let label = doc ? `${doc}${params ? ` ${params}` : ''}` : caseLabel(raw);
    if (!c.ok && isCollectError(raw)) label = COLLECT_ERROR_LABEL;
    const reason = c.ok ? '' : (reasons[raw] ?? String(c.message ?? '').split('\n')[0].trim());
    return { ...c, label, reason };
  });
  return { ...t, cases };
}

// 记录 / 面板用的用例行：{ name(显示名), ok, reason }；live 的 cases（有 label）与记录里的 cases（name 已是显示名）都能读
export function caseRows(t) {
  if (!t || !Array.isArray(t.cases)) return [];
  return t.cases.filter((c) => c && typeof c === 'object').map((c) => ({
    name: typeof c.label === 'string' && c.label ? c.label : (!c.ok && isCollectError(c.name) ? COLLECT_ERROR_LABEL : caseLabel(c.name)),
    ok: !!c.ok,
    reason: c.ok ? '' : String(c.reason ?? c.message ?? '').split('\n')[0].trim(),
  }));
}

export function reportCases(t) {
  const rows = caseRows(t);
  if (rows.length === 0) return null;
  return rows.slice(0, CASES_MAX).map((r) => ({
    name: clip(r.name || '?', CASE_NAME_MAX),
    ok: r.ok,
    reason: clip(r.reason, CASE_REASON_MAX),
  }));
}
