import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config, { QUESTION, OPTIONS } from '../stage.config.js';
import { register } from '../server.js';

function makeCtx(names = ['A']) {
  const now = Date.now();
  const ctx = mockCtx({
    stageId: 'vote',
    config,
    students: names.map((name) => ({ name, connected: true, enteredStageAt: now, enteredStageIndex: 1 })),
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const vote = (ctx, name, choice) => ctx.dispatch('student:vote', { role: 'student', name }, { choice });

test('student:vote 正向：写入 choice 与 submittedAt，并通知教师与本人', async () => {
  const ctx = makeCtx();
  const r = await vote(ctx, 'A', 'B');
  assert.equal(r.ok, true);
  const rec = ctx.data.get('A');
  assert.equal(rec.choice, 'B');
  assert.equal(typeof rec.submittedAt, 'number');
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:data-update' && e.target.kind === 'teachers'));
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:my-data' && e.target.kind === 'student' && e.target.name === 'A'));
});

test('student:vote 可改选：第二次覆盖 choice', async () => {
  const ctx = makeCtx();
  await vote(ctx, 'A', 'A');
  const r = await vote(ctx, 'A', 'D');
  assert.equal(r.ok, true);
  assert.equal(ctx.data.get('A').choice, 'D');
});

test('student:vote 非法选项被 schema 拒绝，不写入', async () => {
  const ctx = makeCtx();
  const r = await vote(ctx, 'A', 'E');
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:vote 未知键被 schema 拒绝', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:vote', { role: 'student', name: 'A' }, { choice: 'A', extra: 1 });
  assert.equal(r.ok, false);
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:vote 教师 socket 被拒绝', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:vote', { role: 'teacher', name: null }, { choice: 'A' });
  assert.equal(r.ok, false);
});

test('gate：在线提交未到 70% 返回 soft 失败', async () => {
  const ctx = makeCtx(['A', 'B', 'C', 'D']);
  await vote(ctx, 'A', 'A');
  await vote(ctx, 'B', 'B');
  const g = await ctx.gate();
  assert.equal(g.ok, false);
  assert.equal(g.soft, true);
  assert.ok(g.reason);
});

test('gate：在线提交达到 70% 通过', async () => {
  const ctx = makeCtx(['A', 'B', 'C', 'D']);
  for (const n of ['A', 'B', 'C']) await vote(ctx, n, 'C');
  const g = await ctx.gate();
  assert.equal(g.ok, true);
});

test('gate：离线学生不计入分母', async () => {
  const now = Date.now();
  const ctx = mockCtx({
    stageId: 'vote',
    config,
    students: [
      { name: 'A', connected: true, enteredStageAt: now, enteredStageIndex: 1 },
      { name: 'B', connected: false, enteredStageAt: null, enteredStageIndex: null },
    ],
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  await vote(ctx, 'A', 'A');
  assert.equal((await ctx.gate()).ok, true);
});

test('onEnter 写入班级题目与选项', async () => {
  const ctx = makeCtx();
  await config.onEnter(ctx);
  const cls = ctx.data.getClass();
  assert.equal(cls.question, QUESTION);
  assert.deepEqual(cls.options, OPTIONS);
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:class-update' && e.target.kind === 'all'));
});

test('alert idle：进入 3 分钟未提交触发，已提交或未满 3 分钟不触发', () => {
  const idle = config.alerts.find((a) => a.id === 'idle');
  const now = Date.now();
  assert.equal(idle.when({ name: 'A', connected: true, enteredStageAt: now - 181_000 }, now), true);
  assert.equal(idle.when({ name: 'A', connected: true, enteredStageAt: now - 60_000 }, now), false);
  assert.equal(idle.when({ name: 'A', connected: true, enteredStageAt: now - 181_000, choice: 'A' }, now), false);
});

// —— 组件钩子（契约 §二 v0.5）——

test('recommend：已提交者按 submittedAt 升序前 5，reason 为"第 N 个提交"，未提交者不入选', () => {
  const perStudent = {
    F: { choice: 'A', submittedAt: 600 },
    B: { choice: 'B', submittedAt: 200 },
    X: { submittedAt: 50 },
    A: { choice: 'C', submittedAt: 100 },
    E: { choice: 'D', submittedAt: 500 },
    C: { choice: 'A', submittedAt: 300 },
    D: { choice: 'A', submittedAt: 400 },
  };
  const roster = Object.keys(perStudent).map((name) => ({ name, connected: true }));
  assert.deepEqual(config.recommend({ perStudent, roster }), [
    { name: 'A', reason: '第 1 个提交' },
    { name: 'B', reason: '第 2 个提交' },
    { name: 'C', reason: '第 3 个提交' },
    { name: 'D', reason: '第 4 个提交' },
    { name: 'E', reason: '第 5 个提交' },
  ]);
  assert.deepEqual(config.recommend({ perStudent: {}, roster: [] }), []);
});

test('score：提交为 1，否则 0', () => {
  assert.equal(config.score({ choice: 'A', submittedAt: 1 }), 1);
  assert.equal(config.score({}), 0);
  assert.equal(config.score({ choice: null }), 0);
});

test('summarize：我的选择 + 全班最多的选项（并列全部列出）', () => {
  const perStudent = { A: { choice: 'C' }, B: { choice: 'C' }, C: { choice: 'A' } };
  assert.deepEqual(config.summarize(perStudent.C, { perStudent, perClass: {} }), [
    { label: '我的选择', value: 'A（21）' },
    { label: '全班最多的选项', value: 'C（29）' },
  ]);
  const tie = { A: { choice: 'B' }, B: { choice: 'D' } };
  assert.equal(config.summarize(tie.A, { perStudent: tie, perClass: {} })[1].value, 'B（27）、D（33）');
  assert.equal(config.summarize({}, { perStudent: {}, perClass: {} })[0].value, '未作答');
});
