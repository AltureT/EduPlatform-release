// 作品墙客户端（课程本地组件规格 §7、§11 D1）：按钮显隐与计数、教师端本地墙（gallery:wall / gallery:closed）、网格与点一张放大、
// 学生端只靠 perClass.spotlight 放大（匿名不显示名字）、studentAside
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { cleanup } from '@testing-library/react';
import { renderWithKernel } from '#kernel/test-utils/index.js';
import { useComponent } from '#kernel/client/index.js';
import gallery, { TEXT, imageCount, WALL_INITIAL, WALL_HANDLERS } from '../client.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 假阶段配置：score-analysis 开作品墙，vote 没开
vi.mock('../stageConfig.js', () => ({
  useGalleryStage: (id) => id === 'score-analysis',
}));

const {
  teacherToolbar: Toolbar, teacherOverlay: TOverlay, studentOverlay: SOverlay, studentAside: Aside,
} = gallery.slots;
const COMP = (options = {}) => [{ id: 'gallery', label: '作品墙', options, stages: null }];
const WALL = [{ name: '张三', image: 'AAAA', at: 1 }, { name: '李四', image: 'BBBB', at: 2 }];

// 教师端本地切片：模拟收到 gallery:wall（经组件 store 的处理函数得到新切片，再写进本端切片）
function WithWall({ msg, children }) {
  const c = useComponent('gallery');
  useEffect(() => { if (msg) c.setLocal(WALL_HANDLERS['gallery:wall'](WALL_INITIAL, msg)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return children;
}

const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const q = (sel) => document.querySelector(sel);

function teacher(ui, { stage = 'score-analysis', perClass = {}, records = {} } = {}) {
  let r;
  act(() => {
    r = renderWithKernel(ui, {
      role: 'teacher', stage, stageIndex: 1,
      stageData: { [stage]: { perStudent: records, perClass: {} }, 'component:gallery': { perStudent: {}, perClass } },
      components: COMP(),
    });
  });
  return r;
}
function student(ui, { perClass = {}, options = {}, stage = 'score-analysis' } = {}) {
  let r;
  act(() => {
    r = renderWithKernel(ui, {
      role: 'student', stage, stageIndex: 1,
      me: { name: '王五', enteredStageAt: 1, enteredStageIndex: 1 },
      classData: { 'component:gallery': perClass },
      components: COMP(options),
    });
  });
  return r;
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('教师端', () => {
  test('按钮：当前段 gallery 为真时显示"作品墙 (N)"，N = 来源段出过图的人数；点一下发 gallery:t-open；当前段没开时不显示（与正在查看哪段无关）', () => {
    const records = { 张三: { images: ['A'] }, 李四: { images: [], final: { images: ['B'] } }, 王五: { images: [] } };
    expect(imageCount(records)).toBe(2);
    const r = teacher(<Toolbar stageId="score-analysis" />, { records });
    const btn = q('[data-gallery-open]');
    expect(btn.textContent).toBe(TEXT.button(2));
    click(btn);
    expect(r.sent).toEqual([{ event: 'gallery:t-open', payload: {} }]);
    cleanup();
    teacher(<Toolbar stageId="score-analysis" isLive={false} />, { stage: 'vote' });
    expect(q('[data-gallery-open]')).toBeNull();
    cleanup();
    // 当前段开着作品墙、教师在回看别的段：按钮照常显示
    teacher(<Toolbar stageId="vote" isLive={false} />, { records });
    expect(q('[data-gallery-open]')).not.toBeNull();
  });

  test('store：gallery:wall 写进教师端本地切片，gallery:closed 回到初始；学生端没有处理函数', () => {
    expect(gallery.store.teacher.initial).toEqual(WALL_INITIAL);
    expect(WALL_HANDLERS['gallery:wall'](WALL_INITIAL, { wall: WALL, skipped: 2, openedAt: 5 })).toEqual({ wall: WALL, skipped: 2, openedAt: 5 });
    expect(WALL_HANDLERS['gallery:closed']({ wall: WALL, skipped: 0, openedAt: 5 })).toEqual(WALL_INITIAL);
    expect(gallery.store.student.on).toEqual({});
  });

  test('墙：没收到 gallery:wall 时不渲染（班级记录里有旧 wall 也不管）；收到后网格每张标名字，点一张发 spotlight；"关闭"发 t-close 并立即收起；跳过数提示', () => {
    teacher(<TOverlay />, { perClass: { wall: WALL, openedAt: 5 } });
    expect(q('[data-testid="gallery-wall"]')).toBeNull();
    cleanup();
    const r = teacher(<WithWall msg={{ wall: WALL, openedAt: 5, skipped: 2 }}><TOverlay /></WithWall>);
    const cards = [...document.querySelectorAll('[data-gallery-card]')];
    expect(cards.map((c) => c.getAttribute('data-gallery-card'))).toEqual(['张三', '李四']);
    expect(cards[0].querySelector('img').getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(document.body.textContent).toContain(TEXT.skipped(2));
    click(cards[1]);
    click(q('[data-gallery-close]'));
    expect(r.sent).toEqual([
      { event: 'gallery:t-spotlight', payload: { name: '李四' } },
      { event: 'gallery:t-close', payload: {} },
    ]);
    expect(q('[data-testid="gallery-wall"]')).toBeNull();
  });

  test('放大：显示 perClass.spotlight 那一张与"返回"（发不带 name 的 spotlight）；墙上没有图时一句"还没有人出图"', () => {
    const r = teacher(<WithWall msg={{ wall: WALL, openedAt: 5 }}><TOverlay /></WithWall>, { perClass: { spotlight: { name: '李四', image: 'BBBB', at: 6 } } });
    expect(q('[data-gallery-spotlight="李四"]').getAttribute('src')).toBe('data:image/png;base64,BBBB');
    expect(document.querySelectorAll('[data-gallery-card]').length).toBe(0);
    click(q('[data-gallery-back]'));
    expect(r.sent).toEqual([{ event: 'gallery:t-spotlight', payload: {} }]);
    cleanup();
    teacher(<WithWall msg={{ wall: [], openedAt: 5 }}><TOverlay /></WithWall>);
    expect(document.body.textContent).toContain(TEXT.empty);
  });
});

describe('学生端', () => {
  test('spotlight 有值时全体看到放大的那张（带名字）；没有时不渲染；学生端没有打开墙的入口', () => {
    student(<><Toolbar stageId="score-analysis" /><TOverlay /><SOverlay /></>, { perClass: { spotlight: { name: '张三', image: 'AAAA', at: 1 } } });
    expect(q('[data-gallery-caption]').textContent).toBe(TEXT.spotlightOf('张三'));
    expect(q('[data-testid="gallery-spotlight"] img').getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(q('[data-gallery-open]')).toBeNull();
    expect(q('[data-testid="gallery-wall"]')).toBeNull();
    cleanup();
    student(<SOverlay />, { perClass: { spotlight: null } });
    expect(q('[data-testid="gallery-spotlight"]')).toBeNull();
  });

  test('options.anonymous：放大的图不显示名字', () => {
    student(<SOverlay />, { perClass: { spotlight: { name: '张三', image: 'AAAA', at: 1 } }, options: { anonymous: true } });
    expect(q('[data-gallery-caption]').textContent).toBe(TEXT.spotlightAnon);
    expect(document.body.textContent).not.toContain('张三');
  });

  test('studentAside：gallery 为真的段一行提示；其它段返回 null', () => {
    student(<Aside stageId="score-analysis" isLive />);
    expect(q('[data-gallery-aside]').textContent).toBe(TEXT.aside);
    cleanup();
    student(<Aside stageId="vote" isLive />, { stage: 'vote' });
    expect(q('[data-gallery-aside]')).toBeNull();
  });
});
