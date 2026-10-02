// 学生端外壳（规格 §9.2；v0.7 界面整理规格 §2.2）：!joined → 登录；!hydrated → 空；否则 <Shell role="student">：
// - 顶栏：品牌 + 步骤条（narrow 折叠为 "序号 / 总数 · 名称"）+ 重连中 / 本人名字
// - 横幅区：服务端拒绝的一句话提示（4 秒后消失）、回看
// - 内容（overflow: hidden）：live 阶段始终挂载（回看时隐藏），回看阶段按 stage.config.reviewInteractive 决定是否加 inert 锁
// - 操作条：当前可见窗格里 <Page.Actions> 的内容；回看锁定时操作条同样 inert
// 断线期间不卸载阶段视图（只显示"重连中"），重连后 join-ok 前渲染空——理由见 stores/coreStudentStore.js 顶部
// 谢幕 override 取自 lesson.curtain.override
// T9b（教师视图与学生页重排规格 §2.5）：有组件提供 studentDock 时，内容区包一层两列网格 <div data-student-body>：
//   左 <div data-student-stage> = 阶段窗格（原样）；右 = 停靠面板 <aside data-student-dock={id}>（标题行 dockTitle + ✕，下面是该组件的 studentDock），
//   两列之间一条拖柄（role="separator"，data-dock-gutter）。面板宽 --dock-w 缺省 360 px，拖动 / ← → 调 280–520，
//   按课记 localStorage['dock-w:<lessonId>']，双击恢复缺省。打开状态 = coreStudentStore.dock（useDock()）；窄屏不渲染面板。
//   没有任何提供者时不包这一层（未开组件时外壳 DOM 不变）；有提供者时开关面板只改列模板，左列不重新挂载
// S22（上课细节收口规格 §1）：网格恒为三列 minmax(0, 1fr) auto <0px | var(--dock-w)>，第三列宽度过渡 200 ms（global.css 的
//   [data-student-body]；prefers-reduced-motion 下、拖柄拖动时 data-dock-dragging 下没有过渡），面板 <aside> overflow: hidden；
//   关闭后等过渡结束（transitionend，没有事件时 200 ms 兜底）再卸载面板。面板关着时，每个有 dockTab 内容的提供者在
//   内容区（position: relative）右边缘垂直居中画一个 <button data-dock-tab={id}>（纵向排），点它 openDock(id)。
//   窄屏同样画（S22a 偏差：规格只写了宽屏，窄屏去掉横幅后没有别的入口）——窄屏不渲染面板，组件看 dock 自己开 drawer；
//   store 里 dock 指向某个提供者时（宽屏 = 面板开着，窄屏 = 该组件的抽屉开着）不画
import { useEffect, useMemo, useRef, useState } from 'react';
import { coreStudentStore } from '../stores/coreStudentStore.js';
import { assembleStages } from '../stores/stageStores.js';
import StepBar from '../ui/StepBar.jsx';
import Shell from '../layout/Shell.jsx';
import { ActionSinkContext, createActionSink } from '../layout/actionSink.js';
import { PageStageContext } from '../layout/pageContext.js';
import { useNarrow } from '../layout/useNarrow.js';
import Brand from './Brand.jsx';
import StudentLogin from './StudentLogin.jsx';
import Curtain from './Curtain.jsx';
import { useLessonChrome } from './useLessonChrome.js';
import { ComponentSlot, DockSlot, DockTabButton, useStudentBanner, useStudentDockProviders } from './ComponentSlots.jsx';
import Btn from '../ui/Btn.jsx';
import { KernelRoleContext } from '../hooks/roleContext.js';

// PageStageContext 带 lessonId：<Page resizable> 按课记拖宽比例（P5 规格 §4）
// C5：isLive 经 PageStageContext 交给 <Page>，作为 studentAside 槽位的 props
function StageView({ entry, curtainOverride, lessonId = null, isLive = true }) {
  if (!entry) return null;
  if (entry.id === 'prelogin') return <StudentLogin />;
  if (entry.id === 'curtain') return <Curtain role="student" title={entry.label} overrideDir={curtainOverride} />;
  const Comp = entry.Student;
  if (!Comp) return null;
  return (
    <PageStageContext.Provider value={{ view: 'student', config: entry.config, lessonId, isLive }}>
      <Comp />
    </PageStageContext.Provider>
  );
}

// overflow: auto 兜底：未迁移到 <Page> 的阶段超高时可在窗格内滚动；<Page> 根是 flex: 1 / min-height: 0，不会触发这里滚动
const paneStyle = { display: 'flex', flexDirection: 'column', flex: '1 1 0%', minHeight: 0, minWidth: 0, overflow: 'auto' };

const bannerBase = {
  padding: 'var(--sp-2) var(--sp-4)',
  fontSize: 'var(--fs-sm)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  borderBottom: '1px solid var(--border)',
};

// ---------- T9b 停靠面板 ----------
const DOCK_W = Object.freeze({ min: 280, max: 520, initial: 360, step: 16 });
const DOCK_PREFIX = 'dock-w:';
const clampDock = (w) => Math.min(DOCK_W.max, Math.max(DOCK_W.min, Math.round(w)));

function readDockW(lessonId) {
  if (!lessonId) return DOCK_W.initial;
  try {
    const raw = globalThis.localStorage?.getItem(DOCK_PREFIX + lessonId);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampDock(n) : DOCK_W.initial;
  } catch (_) {
    return DOCK_W.initial;
  }
}
function writeDockW(lessonId, w) {
  if (!lessonId) return;
  try {
    if (w == null) globalThis.localStorage?.removeItem(DOCK_PREFIX + lessonId);
    else globalThis.localStorage?.setItem(DOCK_PREFIX + lessonId, String(w));
  } catch (_) {
    // 存储不可用：只在内存里记
  }
}

function useDockWidth(lessonId) {
  const [w, setW] = useState(() => readDockW(lessonId));
  useEffect(() => {
    setW(readDockW(lessonId));
  }, [lessonId]);
  const commit = (next) => {
    const v = clampDock(next);
    setW(v);
    writeDockW(lessonId, v);
  };
  const reset = () => {
    setW(DOCK_W.initial);
    writeDockW(lessonId, null);
  };
  return { w, setW: (next) => setW(clampDock(next)), commit, reset };
}

// 面板左边的拖柄：往左拖加宽（面板在右）；← 加宽、→ 变窄；双击恢复缺省
function DockGutter({ w, onDrag, onCommit, onReset, onDragging }) {
  const drag = useRef(null);   // { x, w, last, moved }
  const [hot, setHot] = useState(false);
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch (_) {
      // 拿不到 pointer（合成事件等）：照常按 move / up 处理
    }
    drag.current = { x: e.clientX, w, last: w, moved: false };
    setHot(true);
    onDragging?.(true);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const next = clampDock(d.w + (d.x - e.clientX));
    if (next === d.last) return;
    d.last = next;
    d.moved = true;
    onDrag(next);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setHot(false);
    onDragging?.(false);
    if (d.moved) onCommit(d.last);
  };
  const onKeyDown = (e) => {
    let next = null;
    if (e.key === 'ArrowLeft') next = w + DOCK_W.step;
    else if (e.key === 'ArrowRight') next = w - DOCK_W.step;
    else if (e.key === 'Home') next = DOCK_W.max;
    else if (e.key === 'End') next = DOCK_W.min;
    if (next == null) return;
    e.preventDefault();
    onCommit(next);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={w}
      aria-valuemin={DOCK_W.min}
      aria-valuemax={DOCK_W.max}
      aria-label="拖动调整面板宽度"
      tabIndex={0}
      data-dock-gutter=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => { if (!drag.current) setHot(false); }}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      style={{
        width: 'var(--sp-3)',
        minHeight: 0,
        display: 'flex',
        justifyContent: 'center',
        cursor: 'col-resize',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{ width: 2, background: hot ? 'var(--border-strong)' : 'var(--border)' }} />
    </div>
  );
}

const dockHeadStyle = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-2) var(--sp-3)',
  borderBottom: '1px solid var(--border)',
  fontWeight: 600,
  color: 'var(--ink)',
};

// S22：面板打开立即挂载；关闭后等网格列过渡结束（transitionend grid-template-columns）或 200 ms 兜底再卸载；关闭途中又打开则不卸载
const DOCK_ANIM_MS = 200;
function useDelayedDock(openId) {
  const [shown, setShown] = useState(openId);
  const timer = useRef(null);
  const clear = () => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => {
    if (openId != null) {
      clear();
      setShown(openId);
      return undefined;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(null);
    }, DOCK_ANIM_MS);
    return clear;
  }, [openId]);
  const onTransitionEnd = (e) => {
    if (openId != null || e.target !== e.currentTarget) return;
    if (e.propertyName && e.propertyName !== 'grid-template-columns') return;
    clear();
    setShown(null);
  };
  return [openId ?? shown, onTransitionEnd];
}

function DockPanel({ provider, onClose }) {
  return (
    <aside
      data-student-dock={provider.id}
      aria-label={provider.title}
      style={{ minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}
    >
      <div data-dock-head="" style={dockHeadStyle}>
        <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider.title}</span>
        <Btn variant="ghost" size="sm" aria-label="关闭" onClick={onClose}>✕</Btn>
      </div>
      <div data-dock-body="" style={{ flex: '1 1 0%', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 'var(--sp-3)' }}>
        <DockSlot provider={provider} />
      </div>
    </aside>
  );
}

// v0.5 组件槽位（规格 §2.3）：studentOverlay 在已加入后的外壳之外；studentCurtain 由 Curtain 在谢幕 / override 之后渲染；
// v0.7.1 studentBanner 在横幅区（内核横幅之后），已加入后即渲染（含课前等待期）
export default function StudentApp() {
  return (
    <KernelRoleContext.Provider value="student">
      <StudentShell />
    </KernelRoleContext.Provider>
  );
}

function StudentShell() {
  const connect = coreStudentStore((s) => s.connect);
  const joined = coreStudentStore((s) => s.joined);
  const hydrated = coreStudentStore((s) => s.hydrated);
  const stageIndex = coreStudentStore((s) => s.stageIndex);
  const viewedStageIndex = coreStudentStore((s) => s.viewedStageIndex);
  const setViewedStageIndex = coreStudentStore((s) => s.setViewedStageIndex);
  const connected = coreStudentStore((s) => s.connected);
  const name = coreStudentStore((s) => s.name);
  const stages = coreStudentStore((s) => s.stages);
  const lesson = coreStudentStore((s) => s.lesson);
  const validationError = coreStudentStore((s) => s.validationError);
  const dock = coreStudentStore((s) => s.dock);
  const closeDock = coreStudentStore((s) => s.closeDock);
  const narrow = useNarrow();
  const componentBanner = useStudentBanner();
  const openDock = coreStudentStore((s) => s.openDock);
  const dockProviders = useStudentDockProviders();
  const dockW = useDockWidth(lesson.id ?? null);
  const activeDock = !narrow && dock ? dockProviders.find((p) => p.id === dock) ?? null : null;
  const [shownDockId, onBodyTransitionEnd] = useDelayedDock(activeDock?.id ?? null);
  const [dockDragging, setDockDragging] = useState(false);
  const [liveSink] = useState(createActionSink);
  const [reviewSink] = useState(createActionSink);

  useLessonChrome(lesson);

  // 服务端拒绝（error:validation）→ 横幅区一句话提示，4 秒后消失（"平台不说废话"允许的一句话错误提示）
  const [toast, setToast] = useState(null);
  useEffect(() => {
    // validationError 被清空（classroom:reset）→ 提示立刻消失，不等 4 秒
    if (!validationError || !validationError.message) {
      setToast(null);
      return undefined;
    }
    setToast(validationError.message);
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [validationError]);

  useEffect(() => {
    connect();
  }, [connect]);

  const entries = useMemo(() => assembleStages(stages), [stages]);
  const steps = useMemo(() => stages.map((s) => s.label), [stages]);

  if (!joined) return <StudentLogin />;
  if (!hydrated) return null;

  const liveEntry = entries[stageIndex] || null;
  // v0.6：已加入且课前等待时也挂 studentOverlay（组件可在此预载；无组件时槽位为空，DOM 不变）
  if (liveEntry && liveEntry.id === 'prelogin') {
    return (
      <>
        <StudentLogin banner={componentBanner} />
        <ComponentSlot role="student" slot="studentOverlay" />
      </>
    );
  }

  const curtainOverride = lesson.curtain ? lesson.curtain.override : null;
  const isReviewing = viewedStageIndex !== stageIndex && viewedStageIndex >= 1;
  const reviewedEntry = isReviewing ? entries[viewedStageIndex] || null : null;
  const lockReview = isReviewing && !(reviewedEntry && reviewedEntry.config && reviewedEntry.config.reviewInteractive === true);

  const header = (
    <>
      <Brand glyph={lesson.glyph} title={narrow ? null : lesson.title} size="sm" />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
        <StepBar steps={steps} step={stageIndex} viewed={viewedStageIndex} onSelect={setViewedStageIndex} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 }}>
        {!connected && (
          <div data-testid="reconnecting" style={{
            height: 28,
            padding: '0 10px',
            borderRadius: 999,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            fontSize: 'var(--fs-xs)',
            fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)', animation: 'pulse 1s infinite' }} />
            重连中…
          </div>
        )}
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{name}</div>
      </div>
    </>
  );

  const banner = [
    toast && (
      <div key="toast" role="alert" style={{ ...bannerBase, background: 'var(--bad-soft)', color: 'var(--bad)', fontWeight: 600 }}>
        {toast}
      </div>
    ),
    isReviewing && (
      <div key="review" data-testid="review-banner" style={{ ...bannerBase, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <span>回看 · {reviewedEntry ? reviewedEntry.label : ''}</span>
        <button
          type="button"
          onClick={() => setViewedStageIndex(stageIndex)}
          style={{
            height: 'var(--control-h-sm)', padding: '0 var(--sp-3)', borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)', color: 'var(--surface)',
            border: 'none', fontSize: 'inherit', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          回到当前 →
        </button>
      </div>
    ),
    // v0.7.1：组件 studentBanner 槽位，在内核横幅之后，每个组件一行、按 lesson.config 顺序纵向堆叠；回看时也显示
    componentBanner,
  ];

  const panes = (
    <>
      {/* live 阶段始终挂载，回看时隐藏以保留其本地状态 */}
      <div data-testid="live-view" style={{ ...paneStyle, display: isReviewing ? 'none' : 'flex' }}>
        <ActionSinkContext.Provider value={liveSink}>
          <StageView entry={liveEntry} curtainOverride={curtainOverride} lessonId={lesson.id} />
        </ActionSinkContext.Provider>
      </div>
      {isReviewing && reviewedEntry && (
        <div data-testid="review-view" inert={lockReview} style={paneStyle}>
          <ActionSinkContext.Provider value={reviewSink}>
            <StageView entry={reviewedEntry} curtainOverride={curtainOverride} lessonId={lesson.id} isLive={false} />
          </ActionSinkContext.Provider>
        </div>
      )}
    </>
  );

  // T9b：有 studentDock 提供者才包网格；窄屏不渲染面板。S22：关闭后 shownDock 留到过渡结束再卸载
  const shownDock = !narrow && shownDockId ? dockProviders.find((p) => p.id === shownDockId) ?? null : null;
  // 面板还在显示（含关闭过渡的 200 ms）或窄屏抽屉开着时不画按钮
  const tabBlocker = shownDockId ?? dock;
  const tabProviders = dockProviders.some((p) => p.id === tabBlocker) ? [] : dockProviders.filter((p) => p.Tab);
  const content = dockProviders.length === 0 ? panes : (
    <div
      data-student-body=""
      data-dock-dragging={dockDragging ? '' : undefined}
      onTransitionEnd={onBodyTransitionEnd}
      style={{
        position: 'relative',
        flex: '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: activeDock ? 'minmax(0, 1fr) auto var(--dock-w)' : 'minmax(0, 1fr) auto 0px',
        gridTemplateRows: 'minmax(0, 1fr)',
        '--dock-w': `${dockW.w}px`,
      }}
    >
      <div data-student-stage="" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {panes}
      </div>
      {shownDock && <DockGutter w={dockW.w} onDrag={dockW.setW} onCommit={dockW.commit} onReset={dockW.reset} onDragging={setDockDragging} />}
      {shownDock && <DockPanel key={shownDock.id} provider={shownDock} onClose={closeDock} />}
      {tabProviders.length > 0 && (
        <div
          data-dock-tabs=""
          style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--sp-2)' }}
        >
          {tabProviders.map((p) => <DockTabButton key={p.id} provider={p} onOpen={openDock} />)}
        </div>
      )}
    </div>
  );

  return (
    <>
      <Shell
        role="student"
        header={header}
        banner={banner}
        sink={isReviewing ? reviewSink : liveSink}
        inertActions={lockReview}
      >
        {content}
      </Shell>
      <ComponentSlot role="student" slot="studentOverlay" />
    </>
  );
}
