// code 原语内部的纯函数（配置、服务端与视图共用；无 Node / 浏览器依赖）
// record 为 sandbox 记录形状（代码沙盒规格 §3.6）+ submittedAt：{ code, stdout, error, images, tests, runs, ms, submittedAt }
// P3：+ final { code, stdout, error, images, tests, at } 与 finalAt（学生点"上交最终稿"，覆盖式）

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const hasTestsIn = (options) => isPlainObject(options?.tests) && Object.keys(options.tests).length > 0;

// 门槛谓词（_shared/gate.js 的 submitted / ran / testsPassed 由本原语提供）
// P3：submitted = 上交过最终稿（finalAt），自动记录（submittedAt）不算
export const submitted = (r) => r?.finalAt != null;
// 至少跑过一次且最近一次无报错
export const ran = (r) => Number(r?.runs) >= 1 && !r?.error;
// 一次测试结果是否全过：failed + errors === 0 且 total > 0（服务端据此写 firstPassedAt）
export const allPassed = (t) => isPlainObject(t) && Number(t.total) > 0 && Number(t.failed) + Number(t.errors) === 0;
// 门槛 / 芯片 / 推荐 / 提醒用的"测试全过"：看只记一次的 firstPassedAt（测试首次全过的时间），之后再改代码不会掉出
export const testsPassed = (r) => r?.firstPassedAt != null;

// 最近报错的首行，截 max 字
export function errorHead(r, max = 60) {
  const s = String(r?.error ?? '').split('\n')[0].trim();
  return s.length > max ? s.slice(0, max) : s;
}

// 按报错首行聚合：[{ text, count }]，次数降序，同次数按首次出现
export function topErrors(perStudent, n = 3) {
  const counts = new Map();
  for (const r of Object.values(perStudent ?? {})) {
    const head = errorHead(r);
    if (head) counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export function testsText(t) {
  return isPlainObject(t) ? `${Number(t.passed) || 0} / ${Number(t.total) || 0}` : '';
}

// 最终稿（P3）：记录里的 final 子对象；没有则 null。K10：推送里的摘要 final（lite: true，不含代码与输出）也返回 null
export const finalOf = (r) => (isPlainObject(r?.final) && r.final.lite !== true ? r.final : null);

// 学生点"上交最终稿"时服务端写入的字段（覆盖式）；p.stale === true（代码在最近一次运行之后改过）时 final 带 stale: true
export function finalPatch(p, now) {
  const final = { code: p.code, stdout: p.stdout, error: p.error ?? null, images: p.images, tests: p.tests ?? null, at: now };
  if (p.stale === true) final.stale = true;
  return { final, finalAt: now };
}
