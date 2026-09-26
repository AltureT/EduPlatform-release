// code 程序题原语（活动原语规格 §3.4）：一道 Python 编程题，学生在浏览器里写、跑、测；有 pytest 测试时自动判题。
// 建在 sandbox 组件之上（代码沙盒规格 §3）：sandbox 配置由 defaults.sandbox(options) 生成，经 classroom:state 下发。
// 用法见同目录 README.md。defaults 每项是 (options) => 值 的工厂（契约 v0.8 §五）。
import { shape } from '#kernel/server/schema.js';
import { declarativeGate, validateGateSpec } from '../_shared/gate.js';
import { errorHead, finalOf, hasTestsIn, ran, submitted, testsPassed, testsText } from './record.js';

export const DEFAULT_STARTER = "# 在这里写你的代码\n\n\nif __name__ == '__main__':\n    pass\n";
const IDLE_MS = 8 * 60_000;
const MAX_REQUIREMENTS = 10;
const REPORT_CODE_CHARS = 2000;
// starter + tests + files 按 JSON 转义后的 UTF-8 长度合计上限（它们随 options 与 sandbox 经 classroom:state 下发）
export const CONTENT_MAX_BYTES = 200 * 1024;
const escapedBytes = (text) => new TextEncoder().encode(JSON.stringify(text)).length;
const kb = (n) => Math.ceil(n / 1024);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 相对路径、不含 ..、不以 / 开头、非空（与 sandbox 组件的 files 校验一致）
const validRelPath = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0')
  && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
const TEST_NAME_RE = /^[A-Za-z0-9_]+\.py$/;

// 报错信息里不写具体的示例路径（前端打包含本文件，构建插件的输出扫描会把与 options 相同的字符串当成泄露）。
// 补缺省值；{ from } 已由加载器读成文本
export function normalize(raw) {
  const o = { packages: [], starter: DEFAULT_STARTER, idleAlertMs: IDLE_MS, ...raw };
  if (o.gate === undefined) o.gate = hasTestsIn(o) ? { testsPassed: 'all', soft: true } : { ran: 0.7, soft: true };
  return o;
}

const baseShape = shape({
  prompt: 'string:1-4000',
  requirements: 'optional:array:string',
  starter: 'string:0-20000',
  packages: 'array:string',
  files: 'optional:object',
  tests: 'optional:object',
  solution: 'optional:string:1-20000',
  idleAlertMs: 'integer:0-86400000',
});

function validate(o) {
  const { gate, ...rest } = o;
  baseShape(rest);
  const reqs = o.requirements ?? [];
  if (reqs.length > MAX_REQUIREMENTS) throw new Error(`requirements 最多 ${MAX_REQUIREMENTS} 条`);
  reqs.forEach((r, i) => {
    if (r.trim() === '' || r.length > 200) throw new Error(`requirements[${i}] 必须是 1–200 字`);
  });
  for (const [p, content] of Object.entries(o.files ?? {})) {
    if (!validRelPath(p)) throw new Error(`files 的路径 ${JSON.stringify(p)} 不合法（相对路径，不含 ..）`);
    if (typeof content !== 'string') throw new Error(`files[${JSON.stringify(p)}] 必须是文本（或 { from } 引用）`);
  }
  for (const [name, src] of Object.entries(o.tests ?? {})) {
    if (!TEST_NAME_RE.test(name)) throw new Error(`tests 的文件名 ${JSON.stringify(name)} 不合法（字母、数字、下划线，以 .py 结尾）`);
    if (typeof src !== 'string') throw new Error(`tests[${JSON.stringify(name)}] 必须是文本（或 { from } 引用）`);
  }
  const bytes = [o.starter, ...Object.values(o.tests ?? {}), ...Object.values(o.files ?? {})]
    .reduce((n, text) => n + escapedBytes(text), 0);
  if (bytes > CONTENT_MAX_BYTES) {
    throw new Error(`starter、tests、files 经转义后合计 ${kb(bytes)} KB，超过 ${kb(CONTENT_MAX_BYTES)} KB，请精简`);
  }
  const withTests = hasTestsIn(o);
  if (isPlainObject(gate) && 'testsPassed' in gate && !withTests) throw new Error('gate.testsPassed 需要先写 tests');
  validateGateSpec(gate, withTests ? ['submitted', 'ran', 'testsPassed'] : ['submitted', 'ran']);
  return o;
}

function idleText(ms, what) {
  const t = ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} 分钟` : `${Math.round(ms / 1000)} 秒`;
  return `${t}${what}`;
}

// 按时间字段先后取前 5（有 tests：firstPassedAt 首次全过；无 tests：submittedAt 最近一次记录）
const earliest = (perStudent, pred, key, reason) => Object.entries(perStudent ?? {})
  .filter(([, r]) => pred(r) && typeof r[key] === 'number')
  .sort((a, b) => a[1][key] - b[1][key])
  .slice(0, 5)
  .map(([name], i) => ({ name, reason: reason(i) }));

const NOT_FINAL = '（未上交，取最近运行）';
const codeForReport = (code) => {
  const s = String(code ?? '');
  return s.length > REPORT_CODE_CHARS ? `${s.slice(0, REPORT_CODE_CHARS)}…` : s;
};

export default {
  type: 'code',
  label: '程序题',
  layout: 'split',
  requiresComponents: ['sandbox'],
  // 保密选项：参考答案只发教师；sandbox 配置里没有它
  secretOptions: ['solution'],
  options: validate,
  normalize,
  defaults: {
    // sandbox 组件的阶段配置（代码沙盒规格 §3.1 形状）；files + tests ≤ 512 KB 由 sandbox 的 register 再校验
    sandbox: (o) => ({
      packages: o.packages,
      ...(o.files && Object.keys(o.files).length > 0 ? { files: o.files } : {}),
      ...(hasTestsIn(o) ? { tests: o.tests } : {}),
      starter: o.starter,
    }),

    gate: (o) => declarativeGate(o.gate, { submitted, ran, testsPassed }),

    collect: (o) => ({
      perStudent: {
        code: 'text', stdout: 'text', error: 'text', images: 'array', tests: 'object', runs: 'integer', ms: 'integer', submittedAt: 'integer',
        firstPassedAt: 'integer', final: 'object', finalAt: 'integer',
      },
      perClass: { featured: 'text', ...(o.solution ? { showSolution: 'boolean' } : {}) },
    }),

    alerts: (o) => {
      if (!(o.idleAlertMs > 0)) return [];
      const withTests = hasTestsIn(o);
      const done = withTests ? testsPassed : ran;
      return [{
        id: 'idle',
        when: (s, now) => !done(s) && s.enteredStageAt != null && now - s.enteredStageAt > o.idleAlertMs,
        text: idleText(o.idleAlertMs, withTests ? '未通过测试' : '未跑通'),
      }];
    },

    recommend: (o) => (hasTestsIn(o)
      ? ({ perStudent }) => earliest(perStudent, testsPassed, 'firstPassedAt', (i) => `第 ${i + 1} 个测试全过`)
      : ({ perStudent }) => earliest(perStudent, ran, 'submittedAt', (i) => `第 ${i + 1} 个跑通`)),

    // 有 tests：通过率；无 tests：跑通（至少一次、最近一次无报错）1，否则 0
    score: (o) => (record) => {
      if (!hasTestsIn(o)) return ran(record) ? 1 : 0;
      const t = record?.tests;
      return t && Number(t.total) > 0 ? Number(t.passed) / Number(t.total) : 0;
    },

    // P3：有最终稿（final）就用它；没有则用最近运行并标"（未上交，取最近运行）"
    summarize: (o) => (record) => {
      const fin = finalOf(record);
      const src = fin ?? record;
      const mark = !fin && record ? NOT_FINAL : '';
      let first;
      if (hasTestsIn(o)) {
        first = { label: '测试通过', value: src?.tests ? `${testsText(src.tests)}${mark}` : '未测试' };
      } else if (!(Number(record?.runs) >= 1)) {
        first = { label: '运行', value: '未运行' };
      } else {
        const head = errorHead(src, 200);
        const which = fin ? '最终稿' : '最后一次';
        first = { label: '运行', value: `运行 ${record.runs} 次，${which}${head ? `报错：${head}` : '无报错'}${mark}` };
      }
      return [first, { label: '我的代码', value: src?.code ? codeForReport(src.code) : '—' }];
    },
  },
};
