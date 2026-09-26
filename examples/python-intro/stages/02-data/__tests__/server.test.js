import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import { RECORD_LIMITS } from '#components/sandbox/record-shape.js';
import config, { SCORES_CSV } from '../stage.config.js';
import { register } from '../server.js';

function makeCtx(names = ['A']) {
  const now = Date.now();
  const ctx = mockCtx({
    stageId: 'data',
    config,
    students: names.map((name) => ({ name, connected: true, enteredStageAt: now, enteredStageIndex: 2 })),
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const rec = (over = {}) => ({
  code: "import pandas as pd\ndf = pd.read_csv('scores.csv')\n",
  stdout: '',
  error: null,
  images: [PNG],
  tests: null,
  runs: 4,
  ms: 820,
  ...over,
});
const submit = (ctx, name, p) => ctx.dispatch('student:submit', { role: 'student', name }, p);

test('student:submit 正向：记录含 1 张图与 submittedAt，并回执本人', async () => {
  const ctx = makeCtx();
  const r = await submit(ctx, 'A', rec());
  assert.equal(r.ok, true);
  const got = ctx.data.get('A');
  assert.deepEqual(got.images, [PNG]);
  assert.equal(typeof got.submittedAt, 'number');
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:my-data' && e.target.kind === 'student' && e.target.name === 'A'));
});

test('student:submit 无图也可提交（出图与否由统计视图呈现）', async () => {
  const ctx = makeCtx();
  const r = await submit(ctx, 'A', rec({ images: [] }));
  assert.equal(r.ok, true);
  assert.deepEqual(ctx.data.get('A').images, []);
});

test('student:submit 校验失败：2 张图、超长图片、非 base64、未知键', async () => {
  const ctx = makeCtx();
  for (const bad of [
    rec({ images: [PNG, PNG] }),
    rec({ images: ['A'.repeat(RECORD_LIMITS.imageChars + 1)] }),
    rec({ images: ['<svg>'] }),
    { ...rec(), chart: true },
  ]) {
    const r = await submit(ctx, 'A', bad);
    assert.equal(r.ok, false);
    assert.ok(r.error);
  }
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:submit 教师 socket 被拒绝', async () => {
  const ctx = makeCtx();
  assert.equal((await ctx.dispatch('student:submit', { role: 'teacher', name: null }, rec())).ok, false);
});

test('本阶段不注册 student:draft', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:draft', { role: 'student', name: 'A' }, { ...rec(), images: [] });
  assert.notEqual(r.ok, true);
  assert.equal(ctx.data.get('A'), undefined);
});

test('gate：在线提交未到 70% soft 失败，达到则通过', async () => {
  const ctx = makeCtx(['A', 'B', 'C']);
  await submit(ctx, 'A', rec());
  const g = await ctx.gate();
  assert.equal(g.ok, false);
  assert.equal(g.soft, true);
  await submit(ctx, 'B', rec());
  await submit(ctx, 'C', rec());
  assert.equal((await ctx.gate()).ok, true);
});

test('alert no-image：已提交但没有图触发；有图或未提交不触发', () => {
  const a = config.alerts.find((x) => x.id === 'no-image');
  const now = Date.now();
  assert.equal(a.when({ name: 'A', enteredStageAt: now, submittedAt: now, images: [] }, now), true);
  assert.equal(a.when({ name: 'A', enteredStageAt: now, submittedAt: now, images: [PNG] }, now), false);
  assert.equal(a.when({ name: 'A', enteredStageAt: now }, now), false);
});

test('alert idle：进入 8 分钟未提交触发', () => {
  const a = config.alerts.find((x) => x.id === 'idle');
  const now = Date.now();
  assert.equal(a.when({ name: 'A', enteredStageAt: now - 481_000 }, now), true);
  assert.equal(a.when({ name: 'A', enteredStageAt: now - 60_000 }, now), false);
  assert.equal(a.when({ name: 'A', enteredStageAt: now - 481_000, submittedAt: now }, now), false);
});

test('summarize：是否出图 + 全班出图人数', () => {
  const perStudent = { A: { ...rec(), submittedAt: 1 }, B: { ...rec({ images: [] }), submittedAt: 2 }, C: { ...rec(), submittedAt: 3 } };
  assert.deepEqual(config.summarize(perStudent.A, { perStudent, perClass: {} }), [
    { label: '是否出图', value: '是' },
    { label: '全班出图人数', value: 2 },
  ]);
  assert.equal(config.summarize(perStudent.B, { perStudent, perClass: {} })[0].value, '否');
});

test('sandbox 配置：pandas + matplotlib，写入 scores.csv（不含真名）', () => {
  assert.deepEqual(config.sandbox.packages, ['pandas', 'matplotlib']);
  assert.equal(config.sandbox.files['scores.csv'], SCORES_CSV);
  const [header, ...rows] = SCORES_CSV.trim().split('\n');
  assert.equal(header.split(',')[0], '编号');
  assert.ok(rows.length >= 10);
  for (const row of rows) assert.match(row.split(',')[0], /^S\d{2}$/);
});
