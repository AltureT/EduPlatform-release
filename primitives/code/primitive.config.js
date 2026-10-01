// code 程序题原语（活动原语规格 §3.4）：一道 Python 编程题，学生在浏览器里写、跑、测；有 pytest 测试时自动判题。
// 建在 sandbox 组件之上（代码沙盒规格 §3）：sandbox 配置由 defaults.sandbox(options) 生成，经 classroom:state 下发。
// 用法见同目录 README.md。defaults 每项是 (options) => 值 的工厂（契约 v0.8 §五）。
import { shape } from '#kernel/server/schema.js';
import { declarativeGate, validateGateSpec } from '../_shared/gate.js';
import { validateTaskItem } from '../_shared/taskItem.js';
import { clearPushed } from '../_shared/pushCode.js';
import { errorHead, finalOf, hasTestsIn, ran, submitted, testsPassed, testsText } from './record.js';
import { parseMistakes } from './mistakes.js';

export const DEFAULT_STARTER = "# 在这里写你的代码\n\n\nif __name__ == '__main__':\n    pass\n";
const IDLE_MS = 8 * 60_000;
const MAX_REQUIREMENTS = 10;
// P6（代码段教学功能规格 §3）：requirements 条目可写 { text, hint }，hint 1–600 字
const REQ_HINT_MAX = 600;
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

const STARTERS_MIN = 2;
const STARTERS_MAX = 4;
const LABEL_MAX = 12;
const STARTER_MAX = 20000;

// P6（代码段教学功能规格 §4.1）：starter 写成数组 [{ label: 1–12 字, code }]（2–4 份，label 不重复；code 可 { from }，已读成文本）
function normalizeStarters(list) {
  if (list.length < STARTERS_MIN || list.length > STARTERS_MAX) {
    throw new Error(`starter 写成数组时要 ${STARTERS_MIN}–${STARTERS_MAX} 份（每份 { label, code }），现在 ${list.length} 份`);
  }
  const seen = new Set();
  return list.map((s, i) => {
    if (!isPlainObject(s)) throw new Error(`starter[${i}] 必须是 { label, code }`);
    const extra = Object.keys(s).filter((k) => k !== 'label' && k !== 'code');
    if (extra.length > 0) throw new Error(`starter[${i}] 不认识的键 ${extra.join(', ')}（可用：label、code）`);
    if (typeof s.label !== 'string' || s.label.trim() === '' || s.label.length > LABEL_MAX || /[\u0000-\u001f\u007f]/.test(s.label)) {
      throw new Error(`starter[${i}].label 必须是 1–${LABEL_MAX} 字（不含换行等控制字符）`);
    }
    if (seen.has(s.label)) throw new Error(`starter[${i}].label 与前面重复（每份的名字要不同）`);
    seen.add(s.label);
    if (typeof s.code !== 'string') throw new Error(`starter[${i}].code 必须是文本（或 { from } 引用）`);
    if (s.code.length > STARTER_MAX) throw new Error(`starter[${i}].code 超过 ${STARTER_MAX} 字`);
    return { label: s.label, code: s.code };
  });
}

// 报错信息里不写具体的示例路径（前端打包含本文件，构建插件的输出扫描会把与 options 相同的字符串当成泄露）。
// 补缺省值；{ from } 已由加载器读成文本。
// P6：starter 为数组时统一成 starters: [{ label, code }]（内部字段，随 options 下发学生），starter 取第一份的 code
// （defaults.sandbox 仍给 sandbox 组件一个字符串）；字符串写法 starters 为 undefined。stage.config.js 里不能直接写 starters。
export function normalize(raw) {
  if (raw && Object.hasOwn(raw, 'starters')) throw new Error('starters 由 starter 数组生成，不能在 stage.config.js 里写（多份起始代码写成 starter: [{ label, code }, …]）');
  const o = { packages: [], starter: DEFAULT_STARTER, idleAlertMs: IDLE_MS, ...raw };
  if (Array.isArray(o.starter)) {
    o.starters = normalizeStarters(o.starter);
    o.starter = o.starters[0].code;
  }
  if (o.gate === undefined) o.gate = hasTestsIn(o) ? { testsPassed: 'all', soft: true } : { ran: 0.7, soft: true };
  // V2（代码题批改规格 §4.3）：mistakes 由加载器读成文本（{ from } 引用 prep:tests 生成的 JSON），这里解析并校验形状
  if (o.mistakes !== undefined) o.mistakes = parseMistakes(o.mistakes);
  return o;
}

const baseShape = shape({
  prompt: 'string:1-4000',
  starter: 'string:0-20000',
  starters: 'optional:array:object',
  packages: 'array:string',
  files: 'optional:object',
  tests: 'optional:object',
  solution: 'optional:string:1-20000',
  mistakes: 'optional:object',
  idleAlertMs: 'integer:0-86400000',
});

function validate(o) {
  const { gate, requirements, ...rest } = o;
  baseShape(rest);
  if (requirements !== undefined && !Array.isArray(requirements)) throw new Error('requirements 必须是数组（每项是字符串或 { text, hint }）');
  const reqs = requirements ?? [];
  if (reqs.length > MAX_REQUIREMENTS) throw new Error(`requirements 最多 ${MAX_REQUIREMENTS} 条`);
  reqs.forEach((r, i) => validateTaskItem('requirements', r, i, REQ_HINT_MAX));
  for (const [p, content] of Object.entries(o.files ?? {})) {
    if (!validRelPath(p)) throw new Error(`files 的路径 ${JSON.stringify(p)} 不合法（相对路径，不含 ..）`);
    if (typeof content !== 'string') throw new Error(`files[${JSON.stringify(p)}] 必须是文本（或 { from } 引用）`);
  }
  for (const [name, src] of Object.entries(o.tests ?? {})) {
    if (!TEST_NAME_RE.test(name)) throw new Error(`tests 的文件名 ${JSON.stringify(name)} 不合法（字母、数字、下划线，以 .py 结尾）`);
    if (typeof src !== 'string') throw new Error(`tests[${JSON.stringify(name)}] 必须是文本（或 { from } 引用）`);
  }
  // P6：多份起始代码时每份都算（starter 就是第一份）
  const starterTexts = Array.isArray(o.starters) ? o.starters.map((x) => x.code) : [o.starter];
  const bytes = [...starterTexts, ...Object.values(o.tests ?? {}), ...Object.values(o.files ?? {})]
    .reduce((n, text) => n + escapedBytes(text), 0);
  if (bytes > CONTENT_MAX_BYTES) {
    throw new Error(`starter、tests、files 经转义后合计 ${kb(bytes)} KB，超过 ${kb(CONTENT_MAX_BYTES)} KB，请精简`);
  }
  const withTests = hasTestsIn(o);
  if (isPlainObject(gate) && 'testsPassed' in gate && !withTests) throw new Error('gate.testsPassed 需要先写 tests');
  if (o.mistakes !== undefined && !withTests) throw new Error('mistakes 需要先写 tests');
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
  // P5（代码段布局与回看规格 §6.1）：回看时可滚动、编辑、运行、测试（不记录、不能上交，由视图保证）；阶段写 reviewInteractive: false 可关
  reviewInteractive: true,
  requiresComponents: ['sandbox'],
  // 保密选项：参考答案与错误库（V2）只发教师；sandbox 配置里没有它们
  secretOptions: ['solution', 'mistakes'],
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
        // P6（代码段教学功能规格 §2.2）：参考答案公布之后到达的记录带 afterSolution（最终稿写在 final.afterSolution）
        afterSolution: 'boolean',
        // P6（§4.3）：多份起始代码时学生选的那份的 label
        starterLabel: 'text',
        // V2（代码题批改规格 §4.3）：有错误库时服务端按测试失败集合匹配的错误类型 { id, label } | null（最终稿写在 final.mistake）。
        // collect 只声明列名（契约 §二"只用于导出列名、详情弹窗字段名、报告筛选；内核只透传"），没有可空写法，值为 null 照常
        // （同 perClass.featured）；导出为空格，个人报告走本原语的 summarize，不带这个字段
        ...(o.mistakes ? { mistake: 'object' } : {}),
      },
      perClass: {
        featured: 'text',
        ...(o.solution ? { showSolution: 'boolean', solution: 'text', solutionPublishedAt: 'integer' } : {}),
      },
    }),

    // P7（教师现场演示规格 §3）：段切换时清掉教师下发的代码（perClass.pushedCode）
    onLeave: clearPushed,

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
      // U6：有代码时 format: 'code'，报告里按代码块（<CodeView>）显示；没有代码仍是一行"—"
      return [first, src?.code ? { label: '我的代码', value: codeForReport(src.code), format: 'code' } : { label: '我的代码', value: '—' }];
    },
  },
};
