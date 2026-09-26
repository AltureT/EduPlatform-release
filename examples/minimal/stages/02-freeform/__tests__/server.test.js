import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config from '../stage.config.js';
import { register } from '../server.js';

function makeCtx() {
  const ctx = mockCtx({
    stageId: 'freeform',
    config,
    students: [{ name: 'A', connected: true, enteredStageAt: Date.now(), enteredStageIndex: 2 }],
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const write = (ctx, text) => ctx.dispatch('student:write', { role: 'student', name: 'A' }, { text });

test('student:write 正向：写入 text、length 与 updatedAt，并回执本人', async () => {
  const ctx = makeCtx();
  const r = await write(ctx, '你好世界');
  assert.equal(r.ok, true);
  const rec = ctx.data.get('A');
  assert.equal(rec.text, '你好世界');
  assert.equal(rec.length, 4);
  assert.equal(typeof rec.updatedAt, 'number');
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:my-data' && e.target.kind === 'student' && e.target.name === 'A'));
});

test('student:write 可多次修改，空串允许', async () => {
  const ctx = makeCtx();
  await write(ctx, 'abc');
  const r = await write(ctx, '');
  assert.equal(r.ok, true);
  assert.equal(ctx.data.get('A').text, '');
  assert.equal(ctx.data.get('A').length, 0);
});

test('student:write 100 字通过，101 字被 schema 拒绝', async () => {
  const ctx = makeCtx();
  assert.equal((await write(ctx, '字'.repeat(100))).ok, true);
  const r = await write(ctx, '字'.repeat(101));
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.equal(ctx.data.get('A').length, 100);
});

test('student:write 按 UTF-16 长度计：100 个 emoji 被拒，50 个 emoji 通过且 length 为 100', async () => {
  const ctx = makeCtx();
  const rejected = await write(ctx, '😀'.repeat(100));
  assert.equal(rejected.ok, false);
  assert.equal(ctx.data.get('A'), undefined);
  const r = await write(ctx, '😀'.repeat(50));
  assert.equal(r.ok, true);
  assert.equal(ctx.data.get('A').length, 100);
});

test('student:write 非字符串被 schema 拒绝', async () => {
  const ctx = makeCtx();
  const r = await write(ctx, 42);
  assert.equal(r.ok, false);
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:write 教师 socket 被拒绝', async () => {
  const ctx = makeCtx();
  const r = await ctx.dispatch('student:write', { role: 'teacher', name: null }, { text: 'x' });
  assert.equal(r.ok, false);
});

test('gate：无门槛，始终通过', async () => {
  const ctx = makeCtx();
  const g = await ctx.gate();
  assert.equal(g.ok, true);
});

// —— 组件钩子（契约 §二 v0.5）——

test('无 recommend / score：share 侧栏手选、互助须手选被帮助者', () => {
  assert.equal(config.recommend, undefined);
  assert.equal(config.score, undefined);
});

test('summarize：字数 + 全班中位数（奇数取中间，偶数取两中间均值，只计有 length 的记录）', () => {
  const odd = { A: { length: 10 }, B: { length: 2 }, C: { length: 30 } };
  assert.deepEqual(config.summarize(odd.A, { perStudent: odd, perClass: {} }), [
    { label: '字数', value: 10, cohort: { median: 10 } },
  ]);
  const even = { A: { length: 4 }, B: { length: 10 }, C: { text: 'x' }, D: { length: 1 }, E: { length: 7 } };
  const [item] = config.summarize(even.B, { perStudent: even, perClass: {} });
  assert.equal(item.value, 10);
  assert.equal(item.cohort.median, 5.5);
});
