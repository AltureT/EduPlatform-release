// 作品墙服务端（课程本地组件规格 §7、§11 D1）：开墙取图只发教师、大小与人数限制、spotlight 只下发一张图并计数、报告条目、关闭 / 换段 / 重置
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCctx } from '#kernel/test-utils/mockCctx.js';
import { register, report, buildWall, pickImage, LIMITS, MSG } from '../server.js';

const teacher = { role: 'teacher' };
const IMG = (c = 'A') => c.repeat(40);

function make({ currentStage = 'score-analysis', records, options = {} } = {}) {
  const cctx = mockCctx({
    id: 'gallery',
    options,
    currentStage,
    stages: [
      { id: 'vote', config: { id: 'vote', label: '投票' } },
      {
        id: 'score-analysis',
        config: { id: 'score-analysis', label: '成绩分析', gallery: true },
        perStudent: records ?? {
          张三: { images: [IMG('a')], submittedAt: 30 },
          李四: { images: [], final: { images: [IMG('b')], at: 10 }, submittedAt: 40 },
          王五: { images: [], submittedAt: 5 },
          赵六: { images: [IMG('c'), IMG('d')], submittedAt: 20 },
        },
      },
    ],
    students: [{ name: '张三' }, { name: '李四' }, { name: '王五' }, { name: '赵六' }],
  });
  register(cctx);
  return cctx;
}

// 发给学生的（全员广播 / 学生群发 / 单个学生）与只发教师的
const toStudents = (cctx) => cctx.emitted.filter((e) => ['all', 'students', 'student'].includes(e.target.kind));
const toTeachers = (cctx, event) => cctx.emitted.filter((e) => e.target.kind === 'teachers' && e.event === event).map((e) => e.payload);
const mark = (cctx) => { cctx.emitted.length = 0; };

test('t-open：整面墙只定向发给教师（gallery:wall），不进班级记录；每人最近记录的第一张图，按出图先后', async () => {
  const cctx = make();
  const r = await cctx.dispatch('gallery:t-open', teacher, {});
  assert.equal(r.ok, true);
  const [msg] = toTeachers(cctx, 'gallery:wall');
  assert.deepEqual(msg.wall.map((w) => [w.name, w.image[0], w.at]), [['李四', 'b', 10], ['赵六', 'c', 20], ['张三', 'a', 30]]);
  assert.equal(msg.skipped, 0);
  assert.equal(typeof msg.openedAt, 'number');
  assert.equal(cctx.data.getClass().wall, undefined);
  assert.equal(toStudents(cctx).some((e) => JSON.stringify(e.payload).includes('"wall"')), false);
  assert.equal(toStudents(cctx).some((e) => e.event === 'gallery:wall'), false);
});

test('t-open：当前段没开作品墙 → 拒绝，什么都不发；学生不能发', async () => {
  const cctx = make({ currentStage: 'vote' });
  const r = await cctx.dispatch('gallery:t-open', teacher, {});
  assert.equal(r.rejected, MSG.notHere);
  assert.deepEqual(toTeachers(cctx, 'gallery:wall'), []);
  const s = await make().dispatch('gallery:t-open', { role: 'student', name: '张三' }, {});
  assert.equal(s.ok, false);
});

test('大小与人数限制：每张 ≤ 100 KB、≤ 60 人，超出的跳过并记数', () => {
  const big = 'x'.repeat(LIMITS.imageBytes + 1);
  const records = { 甲: { images: [big], submittedAt: 1 } };
  for (let i = 0; i < 62; i += 1) records[`s${String(i).padStart(2, '0')}`] = { images: [IMG()], submittedAt: 100 + i };
  const { wall, skipped } = buildWall(records);
  assert.equal(wall.length, 60);
  assert.equal(skipped, 3);
  assert.equal(wall.some((w) => w.name === '甲'), false);
  assert.equal(wall[0].name, 's00');
  assert.equal(pickImage({ images: [] }), null);
  assert.equal(pickImage(null), null);
});

test('t-spotlight：班级记录只含 spotlight { name, image, at }（学生只收这一张）；shown + 1（重复点同一人不加）；没图 / 太大 → 拒绝；不带 name 取消', async () => {
  const cctx = make({ records: { 张三: { images: [IMG('a')], submittedAt: 1 }, 赵六: { images: [IMG('c')], submittedAt: 2 }, 大: { images: ['x'.repeat(LIMITS.imageBytes + 1)] } } });
  await cctx.dispatch('gallery:t-open', teacher, {});
  mark(cctx);
  assert.equal((await cctx.dispatch('gallery:t-spotlight', teacher, { name: '张三' })).ok, true);
  const updates = cctx.emitted.filter((e) => e.event === 'stage:class-update' && e.payload.stageId === 'component:gallery');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].target.kind, 'all');
  assert.deepEqual(Object.keys(updates[0].payload.data).sort(), ['spotlight', 'updatedAt']);
  assert.deepEqual({ ...updates[0].payload.data.spotlight, at: 0 }, { name: '张三', image: IMG('a'), at: 0 });
  await cctx.dispatch('gallery:t-spotlight', teacher, { name: '张三' });
  assert.equal(cctx.data.get('张三').shown, 1);
  await cctx.dispatch('gallery:t-spotlight', teacher, { name: '赵六' });
  await cctx.dispatch('gallery:t-spotlight', teacher, { name: '张三' });
  assert.equal(cctx.data.get('张三').shown, 2);
  assert.equal(cctx.data.get('赵六').shown, 1);
  assert.equal((await cctx.dispatch('gallery:t-spotlight', teacher, { name: '王五' })).rejected, MSG.noImage('王五'));
  assert.equal((await cctx.dispatch('gallery:t-spotlight', teacher, { name: '大' })).rejected, MSG.noImage('大'));
  await cctx.dispatch('gallery:t-spotlight', teacher, {});
  assert.equal(cctx.data.getClass().spotlight, null);
  assert.equal(toStudents(cctx).some((e) => JSON.stringify(e.payload).includes('"wall"')), false);
});

test('报告条目：我的图被展示过 N 次（没被展示为 0 次）', async () => {
  const cctx = make();
  await cctx.dispatch('gallery:t-spotlight', teacher, { name: '赵六' });
  assert.deepEqual(report('赵六', cctx), [{ label: '我的图被展示过', value: '1 次' }]);
  assert.deepEqual(report('王五', cctx), [{ label: '我的图被展示过', value: '0 次' }]);
});

test('t-close、换段、重置：spotlight 清空，并通知教师端收起（gallery:closed）', async () => {
  const cctx = make();
  const check = (how) => {
    assert.equal(cctx.data.getClass().spotlight, null, how);
    assert.equal(toTeachers(cctx, 'gallery:closed').length, 1, how);
  };
  const opened = async () => {
    await cctx.dispatch('gallery:t-open', teacher, {});
    await cctx.dispatch('gallery:t-spotlight', teacher, { name: '张三' });
    assert.equal(cctx.data.getClass().spotlight.name, '张三');
    mark(cctx);
  };
  await opened();
  await cctx.dispatch('gallery:t-close', teacher, {});
  check('close');
  await opened();
  cctx.fire('stageChange', { from: 'score-analysis', to: 'curtain' });
  check('stageChange');
  await opened();
  cctx.fire('reset');
  check('reset');
});

test('options.source：从别的段取图；来源段不存在 → 拒绝', async () => {
  const cctx = make({ options: { source: 'nope' } });
  const r = await cctx.dispatch('gallery:t-open', teacher, {});
  assert.equal(r.rejected, MSG.noSource);
});
