// 集体拦截 的服务端测试（契约 §七）：node --test 运行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config from '../stage.config.js';
import { register } from '../server.js';
import { TEST_SET, evaluate } from '../data.js';

const GOOD = { link: 10, urgent: 20, transfer: 30, identity: 30, reward: 40, askinfo: 40 };

function makeCtx(names = ['A']) {
  const ctx = mockCtx({
    stageId: 'intercept',
    config,
    students: names.map((name) => ({ name, connected: true, enteredStageAt: Date.now(), enteredStageIndex: 5 })),
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const run = (ctx, body, name = 'A') => ctx.dispatch('student:run', { role: 'student', name }, body);

test('数据：40 条测试短信，24 条诈骗四类各 6、16 条正常', () => {
  assert.equal(TEST_SET.length, 40);
  assert.equal(TEST_SET.filter((s) => s.type === 'normal').length, 16);
  for (const t of ['refund', 'task', 'police', 'friend']) assert.equal(TEST_SET.filter((s) => s.type === t).length, 6);
});

test('student:run 正向：结果与手算一致，四类各抓到几条、误拦了哪几条', async () => {
  const ctx = makeCtx();
  const r = await run(ctx, { weights: GOOD, threshold: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.rejected, undefined);
  const rec = ctx.data.get('A');
  const expect = evaluate(TEST_SET, GOOD, 60);
  assert.equal(rec.f1, expect.f1);
  assert.equal(rec.recall, expect.recall);
  assert.equal(rec.blocked, expect.blocked);
  assert.deepEqual(rec.byType, expect.byType);
  assert.deepEqual(rec.blockedIds, expect.blockedIds);
  assert.equal(typeof rec.ranAt, 'number');
});

test('student:run 再发覆盖（以最后一次为准）', async () => {
  const ctx = makeCtx();
  await run(ctx, { weights: GOOD, threshold: 60 });
  await run(ctx, { weights: GOOD, threshold: 300 });
  assert.equal(ctx.data.get('A').recall, 0);
});

test('student:run 权重越界、线越界被拒', async () => {
  const ctx = makeCtx();
  const r1 = await run(ctx, { weights: { ...GOOD, link: -1 }, threshold: 60 });
  assert.ok(r1.rejected);
  const r2 = await run(ctx, { weights: GOOD, threshold: 400 });
  assert.equal(r2.ok, false);
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:run 教师发被拒', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:run', { role: 'teacher', name: null }, { weights: GOOD, threshold: 60 });
  assert.equal(r.ok, false);
});

test('gate：无门槛，没人跑也通过', async () => {
  const ctx = makeCtx(['A', 'B']);
  assert.equal((await ctx.gate()).ok, true);
});

test('gate：无门槛，跑完也通过', async () => {
  const ctx = makeCtx(['A']);
  await run(ctx, { weights: GOOD, threshold: 60 });
  assert.equal((await ctx.gate()).ok, true);
});

test('recommend / score / summarize；不用提醒', () => {
  const perStudent = {
    A: { f1: 0.9, recall: 0.9, blocked: 3 },
    B: { f1: 0.8, recall: 0.8, blocked: 2 },
    C: { f1: 0.7, recall: 0.7, blocked: 4 },
    D: { f1: 0.6, recall: 0.75, blocked: 0 },
    E: { f1: 0.5, recall: 0.5, blocked: 0 },
  };
  assert.deepEqual(config.recommend({ perStudent, roster: [] }).map((r) => r.name), ['A', 'B', 'C', 'D']);
  assert.equal(config.score({ f1: 0.4 }), 0.4);
  const items = config.summarize({ ...perStudent.A, byType: { refund: { caught: 5, total: 6 } } }, { perStudent, perClass: {} });
  assert.deepEqual(items.map((i) => i.label), ['统一测试 F1', '查全', '查准', '误拦数', '冒充客服退款 抓到', '刷单返利 抓到', '冒充公检法 抓到', '冒充熟人 抓到']);
  assert.equal(items[4].value, '5/6');
  assert.equal(items[5].value, '0/0');
  assert.equal(items[0].cohort.median, 0.7);
  assert.deepEqual(config.alerts, []);
});
