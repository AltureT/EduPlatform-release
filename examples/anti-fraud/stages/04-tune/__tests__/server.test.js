// 开放调参 的服务端测试（契约 §七）：node --test 运行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config from '../stage.config.js';
import { register, trendOf, countHits, judge, hitItems } from '../server.js';
import { SAMPLES, evaluate } from '../data.js';

const EQUAL = { link: 20, urgent: 20, transfer: 20, identity: 20, reward: 20, askinfo: 20 };
const GOOD = { link: 10, urgent: 20, transfer: 30, identity: 30, reward: 40, askinfo: 40 };

function makeCtx(names = ['A']) {
  const ctx = mockCtx({
    stageId: 'tune',
    config,
    students: names.map((name) => ({ name, connected: true, enteredStageAt: Date.now(), enteredStageIndex: 4 })),
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const asStudent = (name = 'A') => ({ role: 'student', name });
const testOnce = (ctx, body, name = 'A') => ctx.dispatch('student:test', asStudent(name), body);

test('数据：100 条样本，60 条诈骗、40 条正常', () => {
  assert.equal(SAMPLES.length, 100);
  assert.equal(SAMPLES.filter((s) => s.type !== 'normal').length, 60);
});

test('student:test 首次不填预测正向：记录成绩；全部 20 分、线 60 没成功（抓到不到七成）', async () => {
  const ctx = makeCtx();
  const r = await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: {} });
  assert.equal(r.ok, true);
  assert.equal(r.rejected, undefined);
  const rec = ctx.data.get('A');
  const expect = evaluate(SAMPLES, EQUAL, 60);
  assert.equal(rec.tests, 1);
  assert.equal(rec.last.caught, expect.caught);
  assert.equal(rec.last.blocked, expect.blocked);
  assert.equal(rec.last.success, false);
  assert.equal(rec.failReason, '抓到的诈骗不到七成');
  assert.equal(rec.failStreak, 1);
  assert.equal(rec.predicted, 0);
  assert.equal(rec.history.length, 1);
});

test('student:test 第二次不填预测被拒', async () => {
  const ctx = makeCtx();
  await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: {} });
  const r = await testOnce(ctx, { weights: GOOD, threshold: 60, predict: {} });
  assert.equal(r.rejected, '先填 4 项预测');
  assert.equal(ctx.data.get('A').tests, 1);
});

test('student:test 带预测：成功、猜中计数、连续没成功清零', async () => {
  const ctx = makeCtx();
  await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: {} });
  const expect = evaluate(SAMPLES, GOOD, 60);
  const r = await testOnce(ctx, {
    weights: GOOD,
    threshold: 60,
    predict: { caught: expect.caught + 2, blocked: expect.blocked + 5, recallTrend: 'up', precisionTrend: 'down' },
  });
  assert.equal(r.ok, true);
  const rec = ctx.data.get('A');
  assert.equal(rec.tests, 2);
  assert.equal(rec.last.success, true);
  assert.equal(rec.failReason, null);
  assert.equal(rec.failStreak, 0);
  assert.equal(rec.predicted, 1);
  // 抓到 ±3 猜中；误拦差 5 没猜中；查全升 猜中；查准按实际比较
  const first = evaluate(SAMPLES, EQUAL, 60);
  const expectedHits = 1 + 0 + 1 + (trendOf(expect.precision, first.precision) === 'down' ? 1 : 0);
  assert.equal(rec.last.hits, expectedHits);
  assert.equal(rec.hitsTotal, expectedHits);
  assert.equal(rec.bestF1, expect.f1);
});

test('student:test 预测越界、权重越界、线越界被拒', async () => {
  const ctx = makeCtx();
  const r1 = await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: { caught: 99, blocked: 1, recallTrend: 'up', precisionTrend: 'up' } });
  assert.ok(r1.rejected);
  const r2 = await testOnce(ctx, { weights: { ...EQUAL, reward: 200 }, threshold: 60, predict: {} });
  assert.ok(r2.rejected);
  const r3 = await testOnce(ctx, { weights: EQUAL, threshold: 999, predict: {} });
  assert.equal(r3.ok, false);
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:test 教师发被拒', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:test', { role: 'teacher', name: null }, { weights: EQUAL, threshold: 60, predict: {} });
  assert.equal(r.ok, false);
});

test('连续 2 次没成功：failStreak 到 2，提醒命中', async () => {
  const ctx = makeCtx();
  await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: {} });
  await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: { caught: 20, blocked: 2, recallTrend: 'same', precisionTrend: 'same' } });
  const rec = ctx.data.get('A');
  assert.equal(rec.failStreak, 2);
  assert.equal(rec.last.hits >= 2, true); // 升降都"差不多"
  const streak = config.alerts.find((a) => a.id === 'fail-streak');
  assert.equal(streak.when(rec, Date.now()), true);
});

test('判定与升降', () => {
  assert.deepEqual(judge({ recall: 0.8, blocked: 6 }), { success: false, failReason: '误拦正常短信超过 5 条' });
  assert.deepEqual(judge({ recall: 0.7, blocked: 5 }), { success: true, failReason: null });
  assert.equal(trendOf(0.5, 0.45), 'up');
  assert.equal(trendOf(0.45, 0.5), 'down');
  assert.equal(trendOf(0.5, 0.49), 'same');
  assert.equal(countHits({ caught: 10, blocked: 0, recallTrend: 'up', precisionTrend: 'up' }, { caught: 13, blocked: 2, recall: 1, precision: 1 }, null), 2);
});

test('提醒：5 分钟未检验', () => {
  const idle = config.alerts.find((a) => a.id === 'idle');
  const now = Date.now();
  assert.equal(idle.when({ enteredStageAt: now - 301_000 }, now), true);
  assert.equal(idle.when({ enteredStageAt: now - 301_000, tests: 1 }, now), false);
  assert.equal(idle.when({ enteredStageAt: now - 60_000 }, now), false);
});

test('gate：有人没检验 → 不通过（硬，不带 soft）', async () => {
  const ctx = makeCtx(['A', 'B']);
  await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: {} }, 'A');
  const g = await ctx.gate();
  assert.equal(g.ok, false);
  assert.equal(g.soft, undefined);
  assert.match(g.reason, /1\/2/);
});

test('gate：全部在线学生检验过一次 → 通过', async () => {
  const ctx = makeCtx(['A', 'B']);
  await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: {} }, 'A');
  await testOnce(ctx, { weights: GOOD, threshold: 60, predict: {} }, 'B');
  const g = await ctx.gate();
  assert.equal(g.ok, true);
});

test('recommend / score / summarize', () => {
  const perStudent = {
    A: { tests: 3, bestF1: 0.9, predicted: 1, hitsTotal: 3 },
    B: { tests: 5, bestF1: 0.5, predicted: 4, hitsTotal: 6 },
    C: { tests: 2, bestF1: 0.7, predicted: 0 },
    D: { tests: 6, bestF1: 0.4, predicted: 5 },
    E: { tests: 1, bestF1: 0.3, predicted: 0 },
  };
  const rec = config.recommend({ perStudent, roster: [] });
  assert.deepEqual(rec.map((r) => r.name), ['A', 'C', 'B', 'D']);
  assert.equal(config.score({ bestF1: 0.6 }), 0.6);
  const items = config.summarize(perStudent.A, { perStudent, perClass: {} });
  assert.deepEqual(items.map((i) => i.label), ['检验次数', '最好 F1', '累计猜中']);
  assert.equal(items[1].cohort.median, 0.5);
});

test('history 每条记设置、成绩、预测；last 记每项是否猜中与实际升降', async () => {
  const ctx = makeCtx();
  await testOnce(ctx, { weights: EQUAL, threshold: 60, predict: {} });
  const predict = { caught: 0, blocked: 0, recallTrend: 'up', precisionTrend: 'same' };
  await testOnce(ctx, { weights: GOOD, threshold: 70, predict });
  const rec = ctx.data.get('A');
  assert.deepEqual(rec.history[0].weights, EQUAL);
  assert.equal(rec.history[0].threshold, 60);
  assert.equal(rec.history[0].predict, null);
  assert.deepEqual(rec.history[1].weights, GOOD);
  assert.equal(rec.history[1].threshold, 70);
  assert.deepEqual(rec.history[1].predict, predict);
  const first = evaluate(SAMPLES, EQUAL, 60);
  const now = evaluate(SAMPLES, GOOD, 70);
  assert.equal(rec.last.hitItems.actual.recallTrend, trendOf(now.recall, first.recall));
  assert.equal(rec.last.hitItems.recallTrend, trendOf(now.recall, first.recall) === 'up');
});

test('hitItems：没有上一次时两个升降记 null，不算猜中', () => {
  const h = hitItems({ caught: 10, blocked: 1, recallTrend: 'up', precisionTrend: 'up' }, { caught: 10, blocked: 1, recall: 0.2, precision: 1 }, null);
  assert.equal(h.caught, true);
  assert.equal(h.blocked, true);
  assert.equal(h.recallTrend, null);
  assert.deepEqual(h.actual, { recallTrend: null, precisionTrend: null });
});
