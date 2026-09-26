// 体验 + 建模 的服务端测试（契约 §七）：node --test 运行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config from '../stage.config.js';
import { register } from '../server.js';

const GOOD = { link: 10, urgent: 10, transfer: 20, identity: 30, reward: 40, askinfo: 30 };
const EQUAL = { link: 20, urgent: 20, transfer: 20, identity: 20, reward: 20, askinfo: 20 };

function makeCtx(names = ['A']) {
  const ctx = mockCtx({
    stageId: 'model',
    config,
    students: names.map((name) => ({ name, connected: true, enteredStageAt: Date.now(), enteredStageIndex: 2 })),
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const asStudent = (name = 'A') => ({ role: 'student', name });
const teacher = { role: 'teacher', name: null };
const release = (ctx) => ctx.dispatch('teacher:release', teacher, {});

test('student:pick 正向：每个勾选特征 20 分，写入勾选与 5 条得分', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:pick', asStudent(), { features: ['link', 'urgent', 'transfer'] });
  assert.equal(r.ok, true);
  const rec = ctx.data.get('A');
  assert.deepEqual(rec.step1Features, ['link', 'urgent', 'transfer']);
  assert.deepEqual(rec.step1Scores, [20, 40, 40, 60, 20]);
  assert.equal(typeof rec.step1At, 'number');
});

test('student:pick 不认识的特征键被 schema 拒绝', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:pick', asStudent(), { features: ['phone'] });
  assert.equal(r.ok, false);
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:verify 未放权被拒', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:verify', asStudent(), { weights: GOOD });
  assert.equal(r.rejected, '老师还没放权');
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:verify 放权后：好的权重通过，得分与次数正确', async () => {
  const ctx = makeCtx();
  await release(ctx);
  const r = await ctx.dispatch('student:verify', asStudent(), { weights: GOOD });
  assert.equal(r.ok, true);
  assert.equal(r.rejected, undefined);
  const rec = ctx.data.get('A');
  assert.equal(rec.passed, true);
  assert.deepEqual(rec.verifyScores, [70, 70, 60, 40, 20]);
  assert.equal(rec.verifyCount, 1);
});

test('student:verify 放权后：全部 20 分不通过（正常的缴费通知也到 60），可再验证', async () => {
  const ctx = makeCtx();
  await release(ctx);
  await ctx.dispatch('student:verify', asStudent(), { weights: EQUAL });
  assert.equal(ctx.data.get('A').passed, false);
  await ctx.dispatch('student:verify', asStudent(), { weights: GOOD });
  assert.equal(ctx.data.get('A').passed, true);
  assert.equal(ctx.data.get('A').verifyCount, 2);
});

test('student:verify 权重越界或缺特征被拒', async () => {
  const ctx = makeCtx();
  await release(ctx);
  const r1 = await ctx.dispatch('student:verify', asStudent(), { weights: { ...GOOD, link: 101 } });
  assert.ok(r1.rejected);
  const { link, ...missing } = GOOD;
  void link;
  const r2 = await ctx.dispatch('student:verify', asStudent(), { weights: missing });
  assert.ok(r2.rejected);
  const r3 = await ctx.dispatch('student:verify', asStudent(), { weights: 'x' });
  assert.equal(r3.ok, false);
  assert.equal(ctx.data.get('A')?.passed, undefined);
});

test('teacher:release 正向：班级记录写放权，学生记录写放权时间；重复放权不改时间', async () => {
  const ctx = makeCtx(['A', 'B']);
  const r = await release(ctx);
  assert.equal(r.ok, true);
  const cls = ctx.data.getClass();
  assert.equal(cls.released, true);
  assert.equal(ctx.data.get('A').releasedAt, cls.releasedAt);
  assert.equal(ctx.data.get('B').releasedAt, cls.releasedAt);
  const first = cls.releasedAt;
  await release(ctx);
  assert.equal(ctx.data.getClass().releasedAt, first);
});

test('teacher:release 学生发被拒', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('teacher:release', asStudent(), {});
  assert.equal(r.ok, false);
  assert.equal(ctx.data.getClass().released, undefined);
});

test('gate：有人没验证通过 → 不通过（软）', async () => {
  const ctx = makeCtx(['A', 'B']);
  await release(ctx);
  await ctx.dispatch('student:verify', asStudent('A'), { weights: GOOD });
  const g = await ctx.gate();
  assert.equal(g.ok, false);
  assert.equal(g.soft, true);
  assert.match(g.reason, /1\/2/);
});

test('gate：全部在线学生验证通过 → 通过', async () => {
  const ctx = makeCtx(['A', 'B']);
  await release(ctx);
  await ctx.dispatch('student:verify', asStudent('A'), { weights: GOOD });
  await ctx.dispatch('student:verify', asStudent('B'), { weights: GOOD });
  const g = await ctx.gate();
  assert.equal(g.ok, true);
});

test('提醒：放权后 3 分钟未验证通过', () => {
  const [alert] = config.alerts;
  const now = Date.now();
  assert.equal(alert.when({ releasedAt: now - 181_000 }, now), true);
  assert.equal(alert.when({ releasedAt: now - 181_000, passed: true }, now), false);
  assert.equal(alert.when({ releasedAt: now - 60_000 }, now), false);
  assert.equal(alert.when({}, now), false);
});

test('summarize：不进个人报告', () => {
  assert.deepEqual(config.summarize({ passed: true }, { perStudent: {}, perClass: {} }), []);
});
