// 教师端外壳（规格 §9.2；v0.7 界面整理规格 §2.2）：!token || !ready → 登录；否则 <Shell role="teacher">：
// - 顶栏：品牌 + 阶段导航（narrow 折叠为 "第 N 段 · 名称 ▾" 下拉）+ 组件 teacherToolbar（wide）+ LIVE
// - 横幅区：阶段清单不一致 / 推进受阻原因 / 回看
// - 内容：课前页、谢幕、阶段演示视图（阶段自己的 <Page>，缺省 focus）或统计视图（外壳套 table 模板：
//   Main = TeacherStats，Side = 组件 teacherSidebar；narrow 时侧栏收进操作条 "推荐 ▾" 底部抽屉）
// - 操作条：左侧 演示 / 统计切换（narrow 用短文案）、暂停更新（统计视图，或统计暂停中的任何视图）、阶段 Page.Actions
//   （含 narrow 时的"推荐 ▾"），右侧 "更多 ▾"（narrow 时组件 teacherToolbar 收进这个 Overlay 菜单；菜单里有内容才显示）+ 进入下一段（ConfirmAdvanceBtn；推进受阻时换成 继续 → / 强制继续）
//
// 约定：
// - v0.7：推进入口由外壳操作条提供，阶段的 TeacherStats / TeacherDemo 不再放推进按钮（契约 v0.7）
// - 未登录也先连上 socket 以收到 classroom:state（品牌）；有 token 时 connect 内部才发 teacher:join
// - 谢幕 override 取自 lesson.curtain.override（classroom:state 的 curtain 字段）
// - v0.5 组件槽位（规格 §2.3）：teacherMain 包裹主区域（按顺序嵌套）；teacherOverlay 在外壳之外；
//   teacherCurtain 由 Curtain 在谢幕 / override 之后渲染
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import { assembleStages, findStageMismatch } from '../stores/stageStores.js';
import Btn from '../ui/Btn.jsx';
import ConfirmAdvanceBtn from '../ui/ConfirmAdvanceBtn.jsx';
import { StableLabel } from '../ui/StepBar.jsx';
import ViewToggle from '../ui/ViewToggle.jsx';
import StatsPauseButton from '../table/StatsPauseButton.jsx';
import Shell from '../layout/Shell.jsx';
import Page from '../layout/Page.jsx';
import { PageStageContext } from '../layout/pageContext.js';
import { useNarrow } from '../layout/useNarrow.js';
import Brand from './Brand.jsx';
import Overlay from './Overlay.jsx';
import { OverlayScopeContext } from './overlayStack.js';
import TeacherLogin from './TeacherLogin.jsx';
import TeacherPrelogin from './TeacherPrelogin.jsx';
import Curtain from './Curtain.jsx';
import { useLessonChrome } from './useLessonChrome.js';
import { ComponentSlot, slotProviders, useOpenComponents, wrapTeacherMain } from './ComponentSlots.jsx';
import { KernelRoleContext } from '../hooks/roleContext.js';

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

export const STAGE_MISMATCH_TEXT = '阶段清单不一致，请重新构建';

export default function TeacherApp() {
  return (
    <KernelRoleContext.Provider value="teacher">
      <TeacherShell />
    </KernelRoleContext.Provider>
  );
}

// U5：wide 时按钮字重恒定，选中态的粗体只在 StableLabel 可见层（宽度按隐藏粗体占位层排，不随选中态变）；
// 选中态只改 background / color / border（border 恒 1.5px）。narrow 下拉菜单竖排，字重照旧切换
function navButtonStyle({ isViewed, isCurrent, isPast, isFuture }, narrow) {
  return {
    height: 'var(--control-h-sm)',
    padding: '0 var(--sp-3)',
    borderRadius: 999,
    fontSize: 'var(--fs-sm)',
    fontWeight: narrow && (isViewed || isCurrent) ? 600 : 400,
    background: isViewed ? 'var(--brand)' : isCurrent || isPast ? 'var(--brand-soft)' : 'transparent',
    color: isViewed ? 'var(--surface)' : isFuture ? 'var(--ink-dim)' : 'var(--brand)',
    border: isCurrent && !isViewed ? '1.5px solid var(--brand)' : '1.5px solid transparent',
    cursor: isFuture ? 'not-allowed' : 'pointer',
    opacity: isFuture ? 0.5 : 1,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'all 0.15s',
  };
}

function StageNav({ stages, stageIndex, viewedStageIndex, onSelect, narrow }) {
  const [open, setOpen] = useState(false);
  const buttons = (onPick) => stages.map((st, i) => {
    const flags = { isCurrent: i === stageIndex, isViewed: i === viewedStageIndex, isPast: i < stageIndex, isFuture: i > stageIndex };
    return (
      <button
        key={st.id}
        type="button"
        data-testid={`stage-nav-${st.id}`}
        aria-current={flags.isCurrent ? 'step' : undefined}
        onClick={() => { if (!flags.isFuture) onPick(i); }}
        disabled={flags.isFuture}
        style={narrow ? { ...navButtonStyle(flags, true), height: 'var(--control-h)', borderRadius: 'var(--radius-sm)', textAlign: 'left' } : navButtonStyle(flags, false)}
      >
        {narrow
          ? (i >= 1 ? `${i}. ${st.label}` : st.label)
          : <StableLabel weight={flags.isViewed || flags.isCurrent ? 600 : 400}>{st.label}</StableLabel>}
      </button>
    );
  });

  if (!narrow) {
    return (
      // U5：靠左排（不居中），品牌与右侧组宽度变化（回看时工具栏不渲染等）不再推动按钮横向位置
      <nav style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flex: '1 1 auto', minWidth: 0, overflowX: 'auto', justifyContent: 'flex-start', paddingLeft: 'var(--sp-4)' }}>
        {buttons(onSelect)}
      </nav>
    );
  }
  const viewed = stages[viewedStageIndex];
  return (
    <nav style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
      <button
        type="button"
        data-testid="stage-nav-collapsed"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        style={{
          height: 'var(--control-h-sm)',
          minWidth: 'min(12em, 100%)', // U5：文字长短变化不改按钮宽度；顶栏不够宽时退回省略号（审查补改）
          maxWidth: '100%',
          padding: '0 var(--sp-3)',
          textAlign: 'left',
          borderRadius: 999,
          fontSize: 'var(--fs-sm)',
          fontWeight: 600,
          background: 'var(--brand-soft)',
          color: 'var(--brand)',
          border: '1.5px solid var(--brand)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {viewedStageIndex >= 1 ? `第 ${viewedStageIndex} 段 · ${viewed ? viewed.label : ''} ▾` : `${viewed ? viewed.label : ''} ▾`}
      </button>
      {open && (
        <Overlay variant="menu" testId="stage-nav-menu" onDismiss={() => setOpen(false)}>
          {buttons((i) => { setOpen(false); onSelect(i); })}
        </Overlay>
      )}
    </nav>
  );
}

// narrow 时组件 toolbar 收进操作条的"更多 ▾"菜单（Overlay menu，挂在 body 下）。
// U4（契约 v0.7.2 §八）：
// - 菜单里任意按钮 / [role=button] / 链接点击后（它自己的处理先执行，事件冒泡到这里）自动关闭菜单，不再有 aria 例外；
//   只认菜单 DOM 里的点击（container.contains）：组件从菜单里打开的弹层也挂在 body 下，React 事件虽经 portal 冒泡到这里，
//   但 DOM 上不在菜单里，不误关；<select> 等表单控件不关。组件打开自己的 Overlay 时菜单同样关闭（Overlay menu 形态的行为）
// - 菜单关闭时子树仍挂载（Overlay open={false} 隐藏），组件在 useEffect 里做的登记不会因开合而丢
// - onItems(bool)：菜单内容区是否有组件实际渲染出的内容（提供者都返回 null 时为 false，外壳据此不显示"更多 ▾"按钮）
function closesMenu(target, container) {
  const el = target && typeof target.closest === 'function' ? target.closest('button, [role="button"], a[href]') : null;
  if (!el || !container.contains(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function hasRenderedItems(el) {
  for (const n of el.childNodes) {
    if (n.nodeType === 1) return true;
    if (n.nodeType === 3 && n.textContent.trim() !== '') return true;
  }
  return false;
}

function ToolbarMenu({ open, onClose, onItems, children }) {
  const ref = useRef(null);
  // 每次渲染后测一次（外壳重渲染时）；组件自己重渲染时由 MutationObserver 补测
  useLayoutEffect(() => {
    if (ref.current) onItems(hasRenderedItems(ref.current));
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof MutationObserver !== 'function') return undefined;
    const mo = new MutationObserver(() => onItems(hasRenderedItems(el)));
    mo.observe(el, { childList: true });
    return () => {
      mo.disconnect();
      onItems(false);
    };
  }, [onItems]);
  return (
    <Overlay variant="menu" open={open} testId="toolbar-more-menu" label="更多" onDismiss={onClose}>
      <div
        ref={ref}
        onClick={(e) => { if (closesMenu(e.target, e.currentTarget)) onClose(); }}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--sp-2)' }}
      >
        {children}
      </div>
    </Overlay>
  );
}

function LiveChip() {
  return (
    <div style={{
      height: 28,
      padding: '0 10px',
      background: 'var(--good-soft)',
      color: 'var(--good)',
      borderRadius: 999,
      fontSize: 'var(--fs-xs)',
      fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 6,
      flexShrink: 0,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--good)', animation: 'pulse 1.4s infinite' }} />
      LIVE
    </div>
  );
}

function TeacherShell() {
  const token = coreTeacherStore((s) => s.token);
  const ready = coreTeacherStore((s) => s.authenticated);
  const connect = coreTeacherStore((s) => s.connect);
  const stageIndex = coreTeacherStore((s) => s.stageIndex);
  const viewedStageIndex = coreTeacherStore((s) => s.viewedStageIndex);
  const setViewedStageIndex = coreTeacherStore((s) => s.setViewedStageIndex);
  const viewMode = coreTeacherStore((s) => s.viewMode);
  const setViewMode = coreTeacherStore((s) => s.setViewMode);
  const advanceError = coreTeacherStore((s) => s.advanceError);
  const advance = coreTeacherStore((s) => s.advance);
  const stages = coreTeacherStore((s) => s.stages);
  const lesson = coreTeacherStore((s) => s.lesson);
  const statsPaused = coreTeacherStore((s) => s.statsPaused);
  const statsPending = coreTeacherStore((s) => s.statsPending);
  const pauseStats = coreTeacherStore((s) => s.pauseStats);
  const resumeStats = coreTeacherStore((s) => s.resumeStats);
  const components = useOpenComponents('teacher');
  const narrow = useNarrow();
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreHasItems, setMoreHasItems] = useState(false);
  const onMoreItems = useCallback((v) => setMoreHasItems(v), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  useLessonChrome(lesson);

  // 未登录也先连上，拿到 classroom:state（品牌）；有 token 时 connect 内部发 teacher:join
  useEffect(() => {
    connect();
  }, [connect]);

  const entries = useMemo(() => assembleStages(stages), [stages]);
  const mismatch = useMemo(() => findStageMismatch(stages), [stages]);
  const viewedEntry = entries[viewedStageIndex] || null;
  const hasDemo = !!(viewedEntry && viewedEntry.TeacherDemo);
  const isReviewing = viewedStageIndex !== stageIndex;

  // 当前阶段有 demo 默认 demo；回看默认 stats；切阶段时重置
  useEffect(() => {
    setViewMode(!isReviewing && hasDemo ? 'demo' : 'stats');
  }, [viewedStageIndex, stageIndex, isReviewing, hasDemo, setViewMode]);

  // 菜单内容清空（组件 toolbar 都返回 null）时关掉菜单
  useEffect(() => {
    if (!moreHasItems) setMoreOpen(false);
  }, [moreHasItems]);

  if (!token || !ready) return <TeacherLogin />;

  let content = null;
  let isStage = false;
  let isStatsView = false;
  if (viewedEntry) {
    if (viewedEntry.id === 'prelogin') content = <TeacherPrelogin />;
    else if (viewedEntry.id === 'curtain') {
      content = <Curtain role="teacher" title={viewedEntry.label} overrideDir={lesson.curtain ? lesson.curtain.override : null} />;
    } else {
      isStage = true;
      const Comp = viewMode === 'demo' && hasDemo ? viewedEntry.TeacherDemo : viewedEntry.TeacherStats;
      isStatsView = Comp === viewedEntry.TeacherStats;
      content = Comp ? (
        <PageStageContext.Provider value={{ view: isStatsView ? 'stats' : 'demo', config: viewedEntry.config }}>
          <Comp />
        </PageStageContext.Provider>
      ) : null;
    }
  }

  const slotStageId = viewedEntry ? viewedEntry.id : null;
  const slotIsLive = !isReviewing;
  const mainArea = wrapTeacherMain(components, content, { stageId: slotStageId, isLive: slotIsLive, viewMode });
  const hasSidebar = slotProviders(components, 'teacherSidebar').length > 0;
  const body = isStatsView ? (
    <Page template="table" title={viewedEntry.label} data-testid="teacher-stats-page">
      <Page.Main>{mainArea}</Page.Main>
      {hasSidebar && (
        <Page.Side>
          <ComponentSlot role="teacher" slot="teacherSidebar" props={{ stageId: slotStageId, isLive: slotIsLive }} />
        </Page.Side>
      )}
    </Page>
  ) : mainArea;

  const hasToolbar = slotProviders(components, 'teacherToolbar').length > 0;
  const toolbar = <ComponentSlot role="teacher" slot="teacherToolbar" props={{ stageId: slotStageId, isLive: slotIsLive, viewMode }} />;
  const moreMenu = narrow && hasToolbar;

  const header = (
    <>
      <Brand glyph={lesson.glyph} title={lesson.title} size={narrow ? 'sm' : 'md'} />
      <StageNav
        stages={stages}
        stageIndex={stageIndex}
        viewedStageIndex={viewedStageIndex}
        onSelect={setViewedStageIndex}
        narrow={narrow}
      />
      {/* U5：右侧组靠右、不伸缩；nav 已靠左，此组变窄（回看时工具栏不渲染）不再影响阶段按钮位置 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--sp-2)', flex: '0 0 auto' }}>
        {!narrow && toolbar}
        <LiveChip />
      </div>
    </>
  );

  const banner = [
    mismatch && (
      <div key="mismatch" data-testid="stage-mismatch" role="alert" style={{ ...bannerBase, background: 'var(--warn-soft)', color: 'var(--warn)', fontWeight: 600 }}>
        {STAGE_MISMATCH_TEXT}
      </div>
    ),
    advanceError && (
      <div key="advance-error" data-testid="advance-error" role="alert" style={{ ...bannerBase, background: 'var(--bad-soft)', color: 'var(--bad)' }}>
        <span>{advanceError.reason}</span>
      </div>
    ),
    isReviewing && (
      <div key="review" data-testid="review-banner" style={{ ...bannerBase, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <span>回看 · {viewedEntry ? viewedEntry.label : ''}</span>
        <Btn size="sm" variant="accent" onClick={() => setViewedStageIndex(stageIndex)}>回到当前 →</Btn>
      </div>
    ),
  ];

  const actionsStart = [
    isStage && hasDemo && (
      <div key="toggle" data-testid="view-toggle-wrap" style={{ flexShrink: 0 }}>
        <ViewToggle value={viewMode} onChange={setViewMode} short={narrow} />
      </div>
    ),
    (isStatsView || statsPaused) && (
      <StatsPauseButton
        key="pause"
        paused={statsPaused}
        pendingCount={statsPending}
        onToggle={() => (statsPaused ? resumeStats() : pauseStats())}
      />
    ),
  ];

  let advanceCtl = null;
  if (!isReviewing && advanceError) {
    advanceCtl = advanceError.soft ? (
      <Btn key="continue" data-testid="advance-continue" variant="primary" onClick={() => advance(true)}>继续 →</Btn>
    ) : (
      <ConfirmAdvanceBtn key="force" data-testid="advance-force" variant="danger" confirmVariant="danger" onAdvance={() => advance(true)}>
        强制继续
      </ConfirmAdvanceBtn>
    );
  } else if (!isReviewing && isStage) {
    advanceCtl = (
      <ConfirmAdvanceBtn key="next" data-testid="advance-next" onAdvance={() => advance(false)}>
        进入下一段 →
      </ConfirmAdvanceBtn>
    );
  }

  return (
    <>
      <Shell
        role="teacher"
        header={header}
        banner={banner}
        actionsStart={actionsStart}
        actionsEnd={[
          moreMenu && moreHasItems && (
            <Btn key="more" variant="soft" data-testid="toolbar-more" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
              更多 ▾
            </Btn>
          ),
          advanceCtl,
        ]}
        pageActionsAt="start"
      >
        {body}
        {/* 菜单本身挂在 body 下（portal），放在外壳里只为带上外壳的字号作用域；按钮只在菜单里真有内容时出现 */}
        {moreMenu && <ToolbarMenu open={moreOpen} onClose={closeMore} onItems={onMoreItems}>{toolbar}</ToolbarMenu>}
      </Shell>
      {/* teacherOverlay 在外壳之外（只放 Overlay）：同样带教师端字号作用域 */}
      <OverlayScopeContext.Provider value="teacher">
        <ComponentSlot role="teacher" slot="teacherOverlay" />
      </OverlayScopeContext.Provider>
    </>
  );
}
