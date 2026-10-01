// 代码题批改（代码题批改规格 §3、§4、§5）：隐藏用例、错误库、对拍的纯函数与组装逻辑。
// prep:tests（scripts/prep-tests.mjs）与 check:lesson 第 14 关共用；运行器按 scripts/lib/pyrun-node.js 的接口注入。
//
//   parseHidden(text) → cases（hidden.json 文本；形状不对抛 Error，消息指到"第 N 条"）
//   validateHidden(value) → cases（同上，收已解析的值）
//   hashRepr(repr) → sha256(repr 的 UTF-8) 前 16 位十六进制（与 test_hidden.py 里 _h(v) 相同）
//   renderHiddenTests(cases, hashes) → tests/test_hidden.py 全文（hashes[i] 为 null 的条目不写；序号按 hidden.json 里的位置）
//   hiddenCount(text) → test_hidden.py 里 def test_hidden_ 的个数
//   parseMistakeFile(file, text) → { id, label, hint, code }（开头两行注释"# 错误：…"、"# 提示：…"；不对抛 Error）
//   renderMistakesJson({ cases, mistakes }) → mistakes.json 全文（确定：两空格缩进、末尾换行）
//   mistakeIssues(mistakes) → { uncaught: [id], same: [[a, b]] }（failing 为空的；failing 集合完全相同的两两）
//   displayNames(cases, tests) → 用例显示名（与学生记录 tests.cases[].name 同一算法：docstring 首行优先，否则去 test_ 前缀）
//   computeHidden(runner, code, cases, { files, timeoutMs, initTimeoutMs }) → [{ name, ok, repr?, hash?, error? }]
//   computeMistakes(runner, { solution, tests, files, mistakes, timeoutMs, initTimeoutMs }) → { cases, mistakes: [{ id, label, hint, failing }] }
//   listedLine(isPrimitive) → 要加进 tests 的那一行
import crypto from 'node:crypto';
import { enrichCases, CASE_NAME_MAX } from '../../components/sandbox/client/ui/testReport.js';

export const HIDDEN_JSON = 'hidden.json';
export const HIDDEN_FILE = 'test_hidden.py';
export const HIDDEN_PATH = `tests/${HIDDEN_FILE}`;
export const MISTAKES_DIR = 'mistakes';
export const MISTAKES_JSON = 'mistakes.json';
export const BRUTE_FILE = 'brute.py';
export const HIDDEN_MAX = 30;
export const HIDDEN_NAME_MAX = 30;
export const CALL_MAX = 200;
export const STDIN_LINES_MAX = 20;
export const STDIN_LINE_MAX = 200;
export const MISTAKES_MAX = 8;
export const MISTAKE_LABEL_MAX = 20;
export const MISTAKE_HINT_MAX = 200;
export const SLUG_RE = /^[a-z0-9_-]{1,32}$/;
export const EVAL_TIMEOUT_MS = 10_000;
export const HIDDEN_HEADER = '# 由 npm run prep:tests 生成，不要手改；期望值只存哈希';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const len = (s) => Array.from(s).length;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validateHidden(value) {
  if (!Array.isArray(value)) throw new Error('hidden.json 必须是数组（每条 { name, call } 或 { name, stdin }）');
  if (value.length > HIDDEN_MAX) throw new Error(`hidden.json 最多 ${HIDDEN_MAX} 条，现在 ${value.length} 条`);
  const seen = new Set();
  return value.map((c, i) => {
    const at = `第 ${i + 1} 条`;
    if (!isPlainObject(c)) throw new Error(`${at}必须是 { name, call } 或 { name, stdin }`);
    const extra = Object.keys(c).filter((k) => !['name', 'call', 'stdin'].includes(k));
    if (extra.length > 0) throw new Error(`${at}不认识的键 ${extra.join(', ')}（可用：name、call、stdin）`);
    if (typeof c.name !== 'string' || c.name.trim() === '' || len(c.name) > HIDDEN_NAME_MAX || CONTROL.test(c.name)) {
      throw new Error(`${at}的 name 必须是 1–${HIDDEN_NAME_MAX} 字（不含换行等控制字符）`);
    }
    if (seen.has(c.name)) throw new Error(`${at}的 name "${c.name}" 与前面重复`);
    seen.add(c.name);
    const hasCall = c.call !== undefined;
    const hasStdin = c.stdin !== undefined;
    if (hasCall === hasStdin) throw new Error(`${at}要有 call 或 stdin 之一（不能都写、不能都不写）`);
    if (hasCall) {
      if (typeof c.call !== 'string' || c.call.trim() === '' || len(c.call) > CALL_MAX) {
        throw new Error(`${at}的 call 必须是 1–${CALL_MAX} 字的 Python 表达式`);
      }
      return { name: c.name, call: c.call };
    }
    if (!Array.isArray(c.stdin) || c.stdin.length > STDIN_LINES_MAX) {
      throw new Error(`${at}的 stdin 必须是字符串数组（≤ ${STDIN_LINES_MAX} 行）`);
    }
    c.stdin.forEach((line, k) => {
      if (typeof line !== 'string' || len(line) > STDIN_LINE_MAX || /[\r\n]/.test(line)) {
        throw new Error(`${at}的 stdin 第 ${k + 1} 行必须是 ≤ ${STDIN_LINE_MAX} 字的一行文字`);
      }
    });
    return { name: c.name, stdin: [...c.stdin] };
  });
}

export function parseHidden(text) {
  let value;
  try {
    value = JSON.parse(String(text));
  } catch (err) {
    throw new Error(`hidden.json 不是合法的 JSON：${String(err?.message ?? err).split('\n')[0]}`);
  }
  return validateHidden(value);
}

export const hashRepr = (repr) => crypto.createHash('sha256').update(String(repr), 'utf8').digest('hex').slice(0, 16);

// JSON 字符串字面量也是合法的 Python 双引号字符串（\" \\ \n \uXXXX 两边同义）
const pyStr = (s) => JSON.stringify(String(s));
const docEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function renderHiddenTests(cases, hashes) {
  const list = cases.map((c, i) => ({ c, i, hash: hashes?.[i] ?? null })).filter((x) => typeof x.hash === 'string');
  const anyCall = list.some((x) => x.c.call !== undefined);
  const anyStdin = list.some((x) => x.c.stdin !== undefined);
  const out = [HIDDEN_HEADER, 'import hashlib'];
  if (anyStdin) out.push('import runpy');
  out.push('', '', 'def _h(v):', '    return hashlib.sha256(repr(v).encode()).hexdigest()[:16]');
  if (anyCall) {
    out.push('', '', 'def _call(expr):', '    import main', '    return eval(expr, vars(main))');
  }
  if (anyStdin) {
    out.push(
      '', '',
      'def _run(monkeypatch, capsys, *lines):',
      '    feed = iter(lines)',
      "    monkeypatch.setattr('builtins.input', lambda prompt='': next(feed))",
      "    runpy.run_path('main.py', run_name='__main__')",
      '    return capsys.readouterr().out',
    );
  }
  for (const { c, i, hash } of list) {
    out.push('', '');
    if (c.call !== undefined) {
      out.push(`def test_hidden_${i + 1}():`, `    """隐藏用例：${docEscape(c.name)}"""`, `    assert _h(_call(${pyStr(c.call)})) == '${hash}'`);
    } else {
      const args = ['monkeypatch', 'capsys', ...c.stdin.map(pyStr)].join(', ');
      out.push(`def test_hidden_${i + 1}(monkeypatch, capsys):`, `    """隐藏用例：${docEscape(c.name)}"""`, `    assert _h(_run(${args}).rstrip()) == '${hash}'`);
    }
  }
  return `${out.join('\n')}\n`;
}

export const hiddenCount = (text) => (String(text ?? '').match(/^def test_hidden_\d+\(/gm) ?? []).length;

export function parseMistakeFile(file, text) {
  const base = String(file).replace(/\.py$/, '');
  if (!SLUG_RE.test(base)) throw new Error(`错误库文件名 ${file} 不合法（小写字母、数字、- 或 _，1–32 个，以 .py 结尾）`);
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const m1 = /^#\s*错误[：:]\s*(.*?)\s*$/.exec(lines[0] ?? '');
  if (!m1 || m1[1] === '' || len(m1[1]) > MISTAKE_LABEL_MAX) {
    throw new Error(`错误库 ${file} 第 1 行要写"# 错误：<1–${MISTAKE_LABEL_MAX} 字的类型名>"`);
  }
  const m2 = /^#\s*提示[：:]\s*(.*?)\s*$/.exec(lines[1] ?? '');
  const hint = m2 ? m2[1] : '';
  if (len(hint) > MISTAKE_HINT_MAX) throw new Error(`错误库 ${file} 的提示超过 ${MISTAKE_HINT_MAX} 字`);
  return { id: base, label: m1[1], hint, code: String(text ?? '') };
}

export function renderMistakesJson({ cases, mistakes }) {
  const body = {
    version: 1,
    cases: [...cases],
    mistakes: mistakes.map((m) => ({ id: m.id, label: m.label, hint: m.hint ?? '', failing: [...m.failing] })),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function mistakeIssues(mistakes) {
  const uncaught = mistakes.filter((m) => m.failing.length === 0).map((m) => m.id);
  const same = [];
  const key = (m) => JSON.stringify([...m.failing].sort());
  for (let a = 0; a < mistakes.length; a++) {
    for (let b = a + 1; b < mistakes.length; b++) {
      if (mistakes[a].failing.length > 0 && key(mistakes[a]) === key(mistakes[b])) same.push([mistakes[a].id, mistakes[b].id]);
    }
  }
  return { uncaught, same };
}

// 用例显示名：学生记录 tests.cases[].name 由 sandbox 的 reportCases 生成（docstring 首行优先，否则去 test_ 前缀），这里同一算法
export function displayNames(cases, tests) {
  const t = enrichCases({ cases: cases.map((c) => ({ name: c.name, ok: c.ok, message: '' })), stdout: '' }, tests);
  return t.cases.map((c) => {
    const s = String(c.label ?? c.name);
    return s.length > CASE_NAME_MAX ? `${s.slice(0, CASE_NAME_MAX - 1)}…` : s;
  });
}

// 用参考答案（或笨办法解）逐条求值：call → repr(eval)，stdin → repr(stdout.rstrip())；哈希在 JS 端算
export async function computeHidden(runner, code, cases, { files = {}, timeoutMs = EVAL_TIMEOUT_MS, initTimeoutMs } = {}) {
  const res = await runner.evalCases(code, cases, { files, timeoutMs, initTimeoutMs });
  return cases.map((c, i) => {
    const r = res[i] ?? { ok: false, error: '没有结果' };
    if (r.ok && typeof r.repr === 'string') return { name: c.name, ok: true, repr: r.repr, hash: hashRepr(r.repr) };
    return { name: c.name, ok: false, error: String(r.error ?? '求值出错').split('\n')[0], ...(r.timedOut ? { timedOut: true } : {}) };
  });
}

const allPass = (r) => !r.timedOut && r.total > 0 && r.passed === r.total && r.failed === 0 && r.errors === 0;

// 错误库：参考答案跑一遍取全部用例名，每个错误版本跑一遍取失败用例名（都是显示名）
export async function computeMistakes(runner, { solution, tests, files = {}, mistakes, timeoutMs = 20_000, initTimeoutMs }) {
  const base = await runner.runTests(solution, tests, { files, timeoutMs, initTimeoutMs });
  if (!allPass(base)) {
    const e = new Error(base.timedOut ? '参考答案跑测试超时' : '参考答案没通过测试');
    e.solutionFailed = true;
    throw e;
  }
  const cases = displayNames(base.cases, tests);
  const out = [];
  for (const m of mistakes) {
    const r = await runner.runTests(m.code, tests, { files, timeoutMs, initTimeoutMs });
    let failing;
    if (r.timedOut) failing = [...cases];
    else {
      const names = displayNames(r.cases, tests);
      failing = names.filter((_, k) => !r.cases[k].ok);
      // 收集失败（main.py 语法错等）时 junit 没有逐条用例：按全部失败算
      if (failing.length === 0 && !allPass(r)) failing = [...cases];
    }
    out.push({ id: m.id, label: m.label, hint: m.hint, failing: [...new Set(failing)] });
  }
  return { cases, mistakes: out };
}

export function listedLine(isPrimitive) {
  return isPrimitive
    ? `tests: { …, '${HIDDEN_FILE}': { from: './${HIDDEN_PATH}' } }`
    : `sandbox.tests 里加 '${HIDDEN_FILE}': <${HIDDEN_PATH} 的全文，写成字符串常量>（自写段的 tests 只收文本）`;
}
