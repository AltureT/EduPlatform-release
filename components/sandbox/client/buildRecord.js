// buildRecord(result, { code, tests, runs, draft = false }) → §3.6 记录（纯函数）
// { code(头部 ≤ 20000), stdout(尾部 ≤ 20000), error: 'Type: 首行消息'(≤ 500) | null, images: [≤ 1 张 = imagesCompact[0]],
//   tests: { passed, failed, errors, total, cases? } | null, runs, ms(整数) }；draft:true 或 imagesCompact[0] 为 null 时 images 为 []
// P3：测试结果有用例时 tests.cases = [{ name(显示名), ok, reason }]（≤ 50 条，见 ui/testReport.js）；没有用例时不带 cases
import { RECORD_LIMITS } from '../record-shape.js';
import { reportCases } from './ui/testReport.js';

const clampInt = (v, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};
const count = (v) => clampInt(v, 100000);

function errorSummary(error) {
  if (!error || !error.type) return null;
  const first = String(error.message ?? '').split('\n')[0].trim();
  const s = first ? `${error.type}: ${first}` : String(error.type);
  return s.length > RECORD_LIMITS.error ? s.slice(0, RECORD_LIMITS.error) : s;
}

function testsOf(t) {
  const out = { passed: count(t.passed), failed: count(t.failed), errors: count(t.errors), total: count(t.total) };
  const cases = reportCases(t);
  if (cases) out.cases = cases;
  return out;
}

export function buildRecord(result, { code = '', tests = null, runs = 0, draft = false } = {}) {
  const r = result ?? {};
  const src = typeof code === 'string' ? code : '';
  const out = typeof r.stdout === 'string' ? r.stdout : '';
  const compact = Array.isArray(r.imagesCompact) ? r.imagesCompact[0] : null;
  return {
    code: src.length > RECORD_LIMITS.code ? src.slice(0, RECORD_LIMITS.code) : src,
    stdout: out.length > RECORD_LIMITS.stdout ? out.slice(out.length - RECORD_LIMITS.stdout) : out,
    error: errorSummary(r.error),
    images: !draft && typeof compact === 'string' && compact.length > 0 && compact.length <= RECORD_LIMITS.imageChars ? [compact] : [],
    tests: tests ? testsOf(tests) : null,
    runs: count(runs),
    ms: clampInt(r.ms, 3600000),
  };
}
