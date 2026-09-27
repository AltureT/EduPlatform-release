// sandbox 提交记录形状（代码沙盒组件规格 §3.6）【Node 可用：阶段 server.js 经 #components/sandbox/record-shape.js 引用】
// recordShape / draftShape 是 schema 函数（内核只要求 schema 是函数）：先跑 shape 校验，再做附加校验，最后返回 payload
//   K5：附加校验的消息同样是中文（经 error:validation 显示给学生）
// recordShapeWith(extraRules)（S3）：与 recordShape 同样的包装，但允许阶段附加自己的键（extraRules 走 shape 规则字符串，
//   例如 { statusCode: 'optional:integer:100-599' }）；不能覆盖基础字段；draftShape 不变
import { shape } from '#kernel/server/schema.js';

export const RECORD_LIMITS = Object.freeze({ code: 20000, stdout: 20000, error: 500, imageChars: 80000 });

const IMAGE_RE = /^[A-Za-z0-9+/=]+$/;
const COUNT = 'integer:0-100000';

const BASE_RULES = Object.freeze({
  code: `string:0-${RECORD_LIMITS.code}`,
  stdout: `string:0-${RECORD_LIMITS.stdout}`,
  error: `optional:string:0-${RECORD_LIMITS.error}`,
  images: 'array:string',
  tests: 'optional:object',
  runs: COUNT,
  ms: 'integer:0-3600000',
});
const base = shape(BASE_RULES);
// P3：tests 可带 cases [{ name, ok, reason }]（≤ 50 条；name、reason ≤ 200 字），由 buildRecord 从测试结果生成
export const TESTS_CASES_MAX = 50;
const testsShape = shape({ passed: COUNT, failed: COUNT, errors: COUNT, total: COUNT, cases: 'optional:array:object' });
const caseShape = shape({ name: 'string:0-200', ok: 'boolean', reason: 'string:0-200' });

function check(payload, { maxImages, validate = base }) {
  const p = validate(payload);
  if (p.images.length > maxImages) {
    throw new Error(maxImages === 0 ? '草稿不能带图片（images 应为空）' : `images 最多 ${maxImages} 张`);
  }
  p.images.forEach((img, i) => {
    if (img.length > RECORD_LIMITS.imageChars) throw new Error(`images[${i}] 超过 ${RECORD_LIMITS.imageChars} 字符`);
    if (!IMAGE_RE.test(img)) throw new Error(`images[${i}] 应为 base64 图片`);
  });
  if (p.tests != null) {
    // K5：路径前缀交给 shape()，消息如"字段 tests.passed 应为 integer，收到 1.5"、"缺少字段 tests.cases[0].name"
    testsShape(p.tests, 'tests');
    const cases = p.tests.cases ?? [];
    if (cases.length > TESTS_CASES_MAX) throw new Error(`tests.cases 最多 ${TESTS_CASES_MAX} 条`);
    cases.forEach((c, i) => caseShape(c, `tests.cases[${i}]`));
  }
  return p;
}

export function recordShape(payload) {
  return check(payload, { maxImages: 1 });
}

export function draftShape(payload) {
  return check(payload, { maxImages: 0 });
}

export function recordShapeWith(extraRules) {
  if (extraRules === null || typeof extraRules !== 'object' || Array.isArray(extraRules)) {
    throw new Error('recordShapeWith: extraRules must be an object');
  }
  for (const k of Object.keys(extraRules)) {
    if (Object.hasOwn(BASE_RULES, k)) throw new Error(`recordShapeWith: ${k} is a base record field`);
  }
  const validate = shape({ ...BASE_RULES, ...extraRules });   // 规则非法时在这里就抛
  return function recordShapeExtended(payload) {
    return check(payload, { maxImages: 1, validate });
  };
}
