// parseJunit(xml) → { ok, passed, failed, errors, total, cases: [{ name, ok, message }] }（规格 §3.8 test）
// 只覆盖 pytest --junitxml 的输出形状，不引依赖：
// - 有 <testcase> 时按用例计：<failure> → failed，<error> → errors；收集错误（classname 为空且含 <error>）只计 errors、不计 total
// - 没有 <testcase> 时按 <testsuite> 属性：total = tests，failed = failures，errors = errors
// - 空 / 非法 → { ok:false, passed:0, failed:0, errors:0, total:0, cases:[] }
const MESSAGE_MAX = 300;

const EMPTY = () => ({ ok: false, passed: 0, failed: 0, errors: 0, total: 0, cases: [] });

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const clip = (s) => (s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX - 1)}…` : s);

// 失败 / 错误的消息：message 属性；收集错误的 message 是 "collection failure"，改取正文最后一条 "E " 行
function messageOf(tagAttrs, body) {
  const msg = (tagAttrs.message ?? '').trim();
  if (msg && msg !== 'collection failure') return clip(msg.split('\n')[0]);
  const eLines = decode(body ?? '').split('\n').filter((l) => /^E\s/.test(l)).map((l) => l.replace(/^E\s+/, '').trim());
  return clip(eLines[eLines.length - 1] || msg || 'error');
}

export function parseJunit(xml) {
  if (typeof xml !== 'string' || !/<testsuite\b/.test(xml)) return EMPTY();

  const cases = [];
  let passed = 0;
  let failed = 0;
  let errors = 0;
  let total = 0;
  const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let any = false;
  for (const m of xml.matchAll(caseRe)) {
    any = true;
    const a = attrs(m[1]);
    const inner = m[2] ?? '';
    const failure = /<failure\b([^>]*?)(?:\/>|>([\s\S]*?)<\/failure>)/.exec(inner);
    const error = /<error\b([^>]*?)(?:\/>|>([\s\S]*?)<\/error>)/.exec(inner);
    const skipped = /<skipped\b/.test(inner);
    const name = a.name || a.classname || '?';
    if (error && !a.classname) {
      // 收集错误：不是一个用例
      errors++;
      cases.push({ name, ok: false, message: messageOf(attrs(error[1]), error[2]) });
      continue;
    }
    total++;
    if (failure) {
      failed++;
      cases.push({ name, ok: false, message: messageOf(attrs(failure[1]), failure[2]) });
    } else if (error) {
      errors++;
      cases.push({ name, ok: false, message: messageOf(attrs(error[1]), error[2]) });
    } else {
      if (!skipped) passed++;
      cases.push({ name, ok: true, message: skipped ? 'skipped' : '' });
    }
  }

  if (!any) {
    for (const m of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
      const a = attrs(m[1]);
      total += int(a.tests);
      failed += int(a.failures);
      errors += int(a.errors);
      passed += Math.max(0, int(a.tests) - int(a.failures) - int(a.errors) - int(a.skipped));
    }
  }

  return { ok: total > 0 && failed === 0 && errors === 0 && passed > 0, passed, failed, errors, total, cases };
}
