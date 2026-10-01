import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config from '../stage.config.js';
import { register } from '../server.js';

function makeCtx(names = ['A']) {
  const now = Date.now();
  const ctx = mockCtx({
    stageId: 'tests',
    config,
    students: names.map((name) => ({ name, connected: true, enteredStageAt: now, enteredStageIndex: 3 })),
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const ALL = { passed: 3, failed: 0, errors: 0, total: 3 };
const rec = (over = {}) => ({
  code: 'def grade(score):\n    return "及格"\n',
  stdout: '',
  error: null,
  images: [],
  tests: ALL,
  runs: 3,
  ms: 40,
  ...over,
});
const submit = (ctx, name, p) => ctx.dispatch('student:submit', { role: 'student', name }, p);

test('student:submit 正向：写入 tests 与 submittedAt', async () => {
  const ctx = makeCtx();
  const r = await submit(ctx, 'A', rec());
  assert.equal(r.ok, true);
  assert.deepEqual(ctx.data.get('A').tests, ALL);
  assert.equal(typeof ctx.data.get('A').submittedAt, 'number');
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:my-data' && e.target.name === 'A'));
});

test('student:submit 没有全部通过被拒绝（服务端复核）', async () => {
  const ctx = makeCtx();
  for (const tests of [null, { passed: 2, failed: 1, errors: 0, total: 3 }, { passed: 0, failed: 0, errors: 0, total: 0 }]) {
    const r = await submit(ctx, 'A', rec({ tests }));
    assert.equal(r.ok, false);
    assert.ok(r.rejected);
  }
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:submit schema 失败：tests 缺字段、负数', async () => {
  const ctx = makeCtx();
  assert.equal((await submit(ctx, 'A', rec({ tests: { passed: 3, total: 3 } }))).ok, false);
  assert.equal((await submit(ctx, 'A', rec({ tests: { ...ALL, failed: -1 } }))).ok, false);
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:submit 教师 socket 被拒绝', async () => {
  const ctx = makeCtx();
  assert.equal((await ctx.dispatch('student:submit', { role: 'teacher', name: null }, rec())).ok, false);
});

test('gate：在线提交未到 70% soft 失败，达到则通过', async () => {
  const ctx = makeCtx(['A', 'B', 'C', 'D']);
  await submit(ctx, 'A', rec());
  const g = await ctx.gate();
  assert.equal(g.ok, false);
  assert.equal(g.soft, true);
  for (const n of ['B', 'C']) await submit(ctx, n, rec());
  assert.equal((await ctx.gate()).ok, true);
});

test('score = passed；没有测试记录为 0', () => {
  assert.equal(config.score({ tests: ALL }), 3);
  assert.equal(config.score({ tests: { passed: 1, failed: 2, errors: 0, total: 3 } }), 1);
  assert.equal(config.score({}), 0);
  assert.equal(config.score({ draft: {} }), 0);
});

test('recommend：全对者按提交先后前 5，理由"第 N 个全部通过"', () => {
  const perStudent = {};
  for (let i = 0; i < 7; i += 1) perStudent[`S${i}`] = { tests: ALL, submittedAt: 1000 - i };
  perStudent.X = { tests: { passed: 2, failed: 1, errors: 0, total: 3 }, submittedAt: 1 };
  perStudent.Y = { tests: ALL };
  const roster = Object.keys(perStudent).map((name) => ({ name, connected: true }));
  const out = config.recommend({ perStudent, roster });
  assert.equal(out.length, 5);
  assert.deepEqual(out[0], { name: 'S6', reason: '第 1 个全部通过' });
  assert.deepEqual(out.map((x) => x.name), ['S6', 'S5', 'S4', 'S3', 'S2']);
  assert.deepEqual(config.recommend({ perStudent: {}, roster: [] }), []);
});

test('alert idle：进入 8 分钟仍未全部通过触发；全部通过或未满 8 分钟不触发', () => {
  const a = config.alerts.find((x) => x.id === 'idle');
  const now = Date.now();
  const late = now - 481_000;
  assert.equal(a.when({ name: 'A', enteredStageAt: late }, now), true);
  assert.equal(a.when({ name: 'A', enteredStageAt: late, tests: { passed: 2, failed: 1, errors: 0, total: 3 } }, now), true);
  assert.equal(a.when({ name: 'A', enteredStageAt: late, tests: ALL, submittedAt: now }, now), false);
  assert.equal(a.when({ name: 'A', enteredStageAt: now - 60_000 }, now), false);
  assert.equal(a.when({ name: 'A', enteredStageAt: null }, now), false);
});

test('summarize：通过用例数 + 全班中位数', () => {
  const perStudent = { A: { tests: ALL, submittedAt: 1 }, B: { tests: { passed: 3, failed: 0, errors: 0, total: 3 }, submittedAt: 2 }, C: { tests: ALL, submittedAt: 3 } };
  assert.deepEqual(config.summarize(perStudent.A, { perStudent, perClass: {} }), [
    { label: '通过用例', value: '3 / 3', cohort: { median: 3 } },
  ]);
});

test('sandbox 配置：五个用例（含 90、60 分界值）+ 隐藏用例文件（V2，只存哈希）、starter 有函数签名与 __main__ 守卫', () => {
  const tests = config.sandbox.tests;
  const names = Object.keys(tests);
  assert.deepEqual(names, ['test_grade.py', 'test_hidden.py']);
  assert.equal((tests['test_hidden.py'].match(/^def test_hidden_\d+\(/gm) ?? []).length, 2);
  assert.doesNotMatch(tests['test_hidden.py'], /优秀|及格/, '期望值只存哈希');
  assert.equal((tests[names[0]].match(/^def test_/gm) ?? []).length, 5);
  assert.match(tests[names[0]], /grade\(90\)/);
  assert.match(tests[names[0]], /grade\(60\)/);
  assert.match(config.sandbox.starter, /^def grade\(score\):/m);
  assert.match(config.sandbox.starter, /if __name__ == '__main__':/);
});
