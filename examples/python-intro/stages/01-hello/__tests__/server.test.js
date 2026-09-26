import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config from '../stage.config.js';
import { register } from '../server.js';

function makeCtx(names = ['A']) {
  const now = Date.now();
  const ctx = mockCtx({
    stageId: 'hello',
    config,
    students: names.map((name) => ({ name, connected: true, enteredStageAt: now, enteredStageIndex: 1 })),
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const rec = (over = {}) => ({
  code: 'for i in range(1, 4):\n    print(i)\n',
  stdout: '1\n2\n3\n',
  error: null,
  images: [],
  tests: null,
  runs: 2,
  ms: 12,
  ...over,
});
const submit = (ctx, name, p) => ctx.dispatch('student:submit', { role: 'student', name }, p);
const draft = (ctx, name, p) => ctx.dispatch('student:draft', { role: 'student', name }, p);

test('student:submit 正向：写入记录与 submittedAt，并通知教师与本人', async () => {
  const ctx = makeCtx();
  const r = await submit(ctx, 'A', rec());
  assert.equal(r.ok, true);
  const got = ctx.data.get('A');
  assert.equal(got.code, rec().code);
  assert.equal(got.stdout, '1\n2\n3\n');
  assert.equal(got.runs, 2);
  assert.equal(typeof got.submittedAt, 'number');
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:data-update' && e.target.kind === 'teachers'));
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:my-data' && e.target.kind === 'student' && e.target.name === 'A'));
});

test('student:submit 可重复提交，以最后一次为准', async () => {
  const ctx = makeCtx();
  await submit(ctx, 'A', rec({ stdout: 'x\n' }));
  const r = await submit(ctx, 'A', rec({ stdout: 'y\n', error: "NameError: name 'x' is not defined" }));
  assert.equal(r.ok, true);
  assert.equal(ctx.data.get('A').stdout, 'y\n');
  assert.match(ctx.data.get('A').error, /^NameError/);
});

test('student:submit 校验失败：未知键、缺字段、图片超过 1 张、非 base64 图片、代码超长', async () => {
  const ctx = makeCtx();
  for (const bad of [
    { ...rec(), extra: 1 },
    { code: 'x' },
    rec({ images: ['AAAA', 'BBBB'] }),
    rec({ images: ['不是base64'] }),
    rec({ code: 'x'.repeat(20001) }),
  ]) {
    const r = await submit(ctx, 'A', bad);
    assert.equal(r.ok, false);
    assert.ok(r.error);
  }
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:submit 教师 socket 被拒绝', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:submit', { role: 'teacher', name: null }, rec());
  assert.equal(r.ok, false);
});

test('student:draft 正向：只写 draft 子记录，不写 submittedAt、不覆盖提交字段', async () => {
  const ctx = makeCtx();
  await submit(ctx, 'A', rec({ stdout: 'submitted\n' }));
  const { submittedAt } = ctx.data.get('A');
  const r = await draft(ctx, 'A', rec({ stdout: 'draft\n', runs: 5 }));
  assert.equal(r.ok, true);
  const got = ctx.data.get('A');
  assert.equal(got.stdout, 'submitted\n');
  assert.equal(got.submittedAt, submittedAt);
  assert.equal(got.draft.stdout, 'draft\n');
  assert.equal(got.draft.runs, 5);
  assert.equal(typeof got.draft.at, 'number');
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:data-update' && e.target.kind === 'teachers'));
});

test('student:draft 只有草稿时不产生 submittedAt', async () => {
  const ctx = makeCtx();
  await draft(ctx, 'A', rec());
  assert.equal(ctx.data.get('A').submittedAt, undefined);
});

test('student:draft 不得带图片；未知键被拒', async () => {
  const ctx = makeCtx();
  assert.equal((await draft(ctx, 'A', rec({ images: ['AAAA'] }))).ok, false);
  assert.equal((await draft(ctx, 'A', { ...rec(), extra: 1 })).ok, false);
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:draft 教师 socket 被拒绝', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:draft', { role: 'teacher', name: null }, rec());
  assert.equal(r.ok, false);
});

test('gate：在线提交未到 70% 返回 soft 失败；只有草稿不算提交', async () => {
  const ctx = makeCtx(['A', 'B', 'C', 'D']);
  await submit(ctx, 'A', rec());
  await submit(ctx, 'B', rec());
  await draft(ctx, 'C', rec());
  const g = await ctx.gate();
  assert.equal(g.ok, false);
  assert.equal(g.soft, true);
  assert.ok(g.reason);
});

test('gate：在线提交达到 70% 通过', async () => {
  const ctx = makeCtx(['A', 'B', 'C', 'D']);
  for (const n of ['A', 'B', 'C']) await submit(ctx, n, rec());
  assert.equal((await ctx.gate()).ok, true);
});

test('gate：离线学生不计入分母', async () => {
  const now = Date.now();
  const ctx = mockCtx({
    stageId: 'hello',
    config,
    students: [
      { name: 'A', connected: true, enteredStageAt: now, enteredStageIndex: 1 },
      { name: 'B', connected: false, enteredStageAt: null, enteredStageIndex: null },
    ],
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  await submit(ctx, 'A', rec());
  assert.equal((await ctx.gate()).ok, true);
});

test('alert idle：进入 5 分钟未运行触发；草稿有运行痕迹或已提交不触发', () => {
  const idle = config.alerts.find((a) => a.id === 'idle');
  const now = Date.now();
  const late = now - 301_000;
  assert.equal(idle.when({ name: 'A', enteredStageAt: late }, now), true);
  assert.equal(idle.when({ name: 'A', enteredStageAt: now - 60_000 }, now), false);
  // 只改了代码没运行：草稿 runs 0、无输出、无报错
  assert.equal(idle.when({ name: 'A', enteredStageAt: late, draft: rec({ runs: 0, stdout: '' }) }, now), true);
  assert.equal(idle.when({ name: 'A', enteredStageAt: late, draft: rec({ runs: 1 }) }, now), false);
  assert.equal(idle.when({ name: 'A', enteredStageAt: late, draft: rec({ runs: 0, stdout: '', error: 'SyntaxError: x' }) }, now), false);
  assert.equal(idle.when({ name: 'A', enteredStageAt: late, submittedAt: now - 1000 }, now), false);
  assert.equal(idle.when({ name: 'A', enteredStageAt: null }, now), false);
});

test('recommend / score 缺省：share 侧栏手选', () => {
  assert.equal(config.recommend, undefined);
  assert.equal(config.score, undefined);
});

test('summarize：只有草稿时"未提交"；提交后给运行次数与结果', () => {
  const ctxArg = { perStudent: {}, perClass: {} };
  assert.deepEqual(config.summarize({ draft: rec() }, ctxArg), [{ label: '提交', value: '未提交' }]);
  assert.deepEqual(config.summarize({ ...rec({ runs: 3 }), submittedAt: 1 }, ctxArg), [
    { label: '运行次数', value: 3 },
    { label: '提交结果', value: '运行无报错' },
  ]);
  const [, res] = config.summarize({ ...rec({ error: "NameError: name 'x' is not defined" }), submittedAt: 1 }, ctxArg);
  assert.equal(res.value, 'NameError');
});

test('sandbox 配置：无额外包、有 starter', () => {
  assert.equal(typeof config.sandbox.starter, 'string');
  assert.deepEqual(config.sandbox.packages ?? [], []);
});
