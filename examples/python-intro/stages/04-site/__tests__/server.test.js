import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config from '../stage.config.js';
import { register } from '../server.js';

function makeCtx(names = ['A']) {
  const now = Date.now();
  const ctx = mockCtx({
    stageId: 'site',
    config,
    students: names.map((name) => ({ name, connected: true, enteredStageAt: now, enteredStageIndex: 4 })),
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

const rec = (over = {}) => ({
  code: 'from flask import Flask\napp = Flask(__name__)\n',
  stdout: '',
  error: null,
  images: [],
  tests: null,
  runs: 2,
  ms: 300,
  homeStatus: 200,
  ...over,
});
const submit = (ctx, name, p) => ctx.dispatch('student:submit', { role: 'student', name }, p);

test('student:submit 正向：记录含 code 与首页状态码', async () => {
  const ctx = makeCtx();
  const r = await submit(ctx, 'A', rec());
  assert.equal(r.ok, true);
  const got = ctx.data.get('A');
  assert.equal(got.homeStatus, 200);
  assert.match(got.code, /Flask/);
  assert.equal(typeof got.submittedAt, 'number');
  assert.ok(ctx.emitted.some((e) => e.event === 'stage:my-data' && e.target.name === 'A'));
});

test('student:submit homeStatus 可为 null（还没有 app 或请求失败）', async () => {
  const ctx = makeCtx();
  const r = await submit(ctx, 'A', rec({ homeStatus: null }));
  assert.equal(r.ok, true);
  assert.equal(ctx.data.get('A').homeStatus, null);
});

test('student:submit 校验失败：状态码越界 / 非整数、记录字段非法、未知键', async () => {
  const ctx = makeCtx();
  for (const bad of [
    rec({ homeStatus: 99 }),
    rec({ homeStatus: 600 }),
    rec({ homeStatus: '200' }),
    rec({ images: ['AAAA', 'AAAA'] }),
    { ...rec(), html: '<h1>x</h1>' },
    (() => { const { code: _c, ...rest } = rec(); return rest; })(),
  ]) {
    const r = await submit(ctx, 'A', bad);
    assert.equal(r.ok, false, JSON.stringify(bad).slice(0, 80));
    assert.ok(r.error);
  }
  assert.equal(ctx.data.get('A'), undefined);
});

test('student:submit 教师 socket 被拒绝', async () => {
  const ctx = makeCtx();
  assert.equal((await ctx.dispatch('student:submit', { role: 'teacher', name: null }, rec())).ok, false);
});

test('gate：在线提交未到 70% soft 失败，达到则通过', async () => {
  const ctx = makeCtx(['A', 'B', 'C']);
  await submit(ctx, 'A', rec());
  const g = await ctx.gate();
  assert.equal(g.ok, false);
  assert.equal(g.soft, true);
  await submit(ctx, 'B', rec());
  await submit(ctx, 'C', rec({ homeStatus: 500 }));
  assert.equal((await ctx.gate()).ok, true);
});

test('alert home-error：已提交且首页状态码不是 2xx / 3xx 触发；null（未检查）不算打不开', () => {
  const a = config.alerts.find((x) => x.id === 'home-error');
  const now = Date.now();
  assert.equal(a.when({ name: 'A', submittedAt: now, homeStatus: 500 }, now), true);
  assert.equal(a.when({ name: 'A', submittedAt: now, homeStatus: null }, now), false);
  assert.equal(a.when({ name: 'A', submittedAt: now }, now), false);
  assert.equal(a.when({ name: 'A', submittedAt: now, homeStatus: 502 }, now), true);
  assert.equal(a.when({ name: 'A', submittedAt: now, homeStatus: 200 }, now), false);
  assert.equal(a.when({ name: 'A', submittedAt: now, homeStatus: 302 }, now), false);
  assert.equal(a.when({ name: 'A' }, now), false);
});

test('summarize：首页状态码；null 显示"无"', () => {
  assert.deepEqual(config.summarize({ ...rec(), submittedAt: 1 }, { perStudent: {}, perClass: {} }), [
    { label: '首页状态码', value: 200 },
  ]);
  assert.equal(config.summarize({ ...rec({ homeStatus: null }), submittedAt: 1 }, { perStudent: {}, perClass: {} })[0].value, '无');
});

test('sandbox 配置：flask 预载，starter 为最小 Flask 应用（表单 POST 后 redirect，不调用 app.run）', () => {
  assert.equal(config.sandbox.flask, true);
  const s = config.sandbox.starter;
  assert.match(s, /app = Flask\(__name__\)/);
  assert.match(s, /methods=\['POST'\]/);
  assert.match(s, /redirect\(/);
  assert.match(s, /<form method="post"/);
  assert.doesNotMatch(s, /app\.run\(/);
});
