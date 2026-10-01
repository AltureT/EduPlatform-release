// 教师端外壳（规格 §9.2；v0.7 界面整理规格 §2.2）：!token || !ready → 登录；否则 <Shell role="teacher">：
// - 顶栏（T9a，教师视图与学生页重排规格 §2.1）：只有品牌 + 阶段导航（narrow 折叠为 "第 N 段 · 名称 ▾" 下拉）；
//   组件 teacherToolbar 不进顶栏，LIVE 芯片删除
// - 横幅区：断线"重连中…"（T9a：本页曾入会过、当前 joined 为假时，代替原 LIVE；刚登录还没入会时不显示）/ 服务端拒绝（error:validation，K5，4 秒后消失）/
//   阶段清单不一致 / 推进受阻原因 / 回看
// - 内容：课前页、谢幕、阶段的三个视图（T9a §2.3）——演示视图（T9a §2.2：<DemoProvider><StageStudentView /></DemoProvider>，
//   该段学生页、教师演示模式；阶段目录自带旧式 TeacherDemo.jsx 时仍渲染它）、统计视图（外壳套 table 模板：
//   Main = TeacherStats（view 'stats'），Side = 组件 teacherSidebar；narrow 时侧栏收进操作条 "推荐 ▾" 底部抽屉）、
//   明细表（同样套 table 模板、Main = TeacherStats（view 'table'），通栏不带侧栏）
// - 操作条：左组 演示 / 统计 / 明细切换（narrow 用短文案）→ 组件 teacherToolbar（wide；按 slots.teacherToolbarOrder 排，mirror -10）→
//   暂停更新（统计 / 明细视图，或统计暂停中的任何视图）→ 阶段 Page.Actions（含 narrow 时的"推荐 ▾"）→ TeacherActions
//   （T9a §2.2：阶段 / 原语的可选 TeacherActions.jsx，三个视图都渲染 <TeacherActions stageId />，经 Shell 的 actionsAfterPage）；
//   右组 "更多 ▾"（narrow 时组件 teacherToolbar 收进这个 Overlay 菜单；菜单里有内容才显示）+ 进入下一段（ConfirmAdvanceBtn；推进受阻时换成 继续 → / 强制继续）
//
// 约定：
// - v0.7：推进入口由外壳操作条提供，阶段的 TeacherStats / TeacherDemo 不再放推进按钮（契约 v0.7）
// - 未登录也先连上 socket 以收到 classroom:state（品牌）；有 token 时 connect 内部才发 teacher:join
// - 谢幕 override 取自 lesson.curtain.override（classroom:state 的 curtain 字段）
// - v0.5 组件槽位（规格 §2.3）：teacherMain 包裹主区域（按顺序嵌套）；teacherOverlay 在外壳之外；
//   teacherCurtain 由 Curtain 在谢幕 / override 之后渲染
import { Component, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import { assembleStages, findStageMismatch } from '../stores/stageStores.js';
import Btn from '../ui/Btn.jsx';
import ConfirmAdvanceBtn from '../ui/ConfirmAdvanceBtn.jsx';
import { StableLabel } from '../ui/StepBar.jsx';
import ViewToggle, { VIEW_ITEMS } from '../ui/ViewToggle.jsx';
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
import DemoProvider from '../demo/DemoProvider.jsx';
import StageStudentView from '../mirror/StageStudentView.jsx';

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

// TeacherActions 抛错只记日志、不渲染按钮，不拖垮外壳
class TeacherActionsBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.error('[TeacherActions] 渲染出错', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

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

function TeacherShell() {
  const token = coreTeacherStore((s) => s.token);
  const ready = coreTeacherStore((s) => s.authenticated);
  const joined = coreTeacherStore((s) => s.joined);
  // T9a 审查：只有入会过之后再断开才算"重连中"（首次登录成功到 teacher:join-ok 之间 joined 也为假，不显示）
  const [everJoined, setEverJoined] = useState(false);
  useEffect(() => {
    if (joined) setEverJoined(true);
  }, [joined]);
  const connect = coreTeacherStore((s) => s.connect);
  const stageIndex = coreTeacherStore((s) => s.stageIndex);
  const viewedStageIndex = coreTeacherStore((s) => s.viewedStageIndex);
  const setViewedStageIndex = coreTeacherStore((s) => s.setViewedStageIndex);
  const viewMode = coreTeacherStore((s) => s.viewMode);
  const setViewMode = coreTeacherStore((s) => s.setViewMode);
  const advanceError = coreTeacherStore((s) => s.advanceError);
  const validationError = coreTeacherStore((s) => s.validationError);
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

  // K5：服务端拒绝（error:validation）→ 横幅区一句话提示，4 秒后消失（与学生端 StudentApp 一致）
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

  // 未登录也先连上，拿到 classroom:state（品牌）；有 token 时 connect 内部发 teacher:join
  useEffect(() => {
    connect();
  }, [connect]);

  const entries = useMemo(() => assembleStages(stages), [stages]);
  const mismatch = useMemo(() => findStageMismatch(stages), [stages]);
  const viewedEntry = entries[viewedStageIndex] || null;
  // T9a §2.2：演示视图恒有（缺省是该段学生页；阶段目录自带旧式 TeacherDemo.jsx 时渲染它）
  const hasDemo = true;
  const legacyDemo = viewedEntry ? viewedEntry.TeacherDemo || null : null;
  const isReviewing = viewedStageIndex !== stageIndex;

  // 当前阶段默认演示视图；回看默认统计视图；切阶段时重置
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
  let isStatsView = false;   // 统计视图或明细表（外壳套 table 模板，Main = TeacherStats）
  let dataView = null;       // 'stats' | 'table'
  if (viewedEntry) {
    if (viewedEntry.id === 'prelogin') content = <TeacherPrelogin />;
    else if (viewedEntry.id === 'curtain') {
      content = <Curtain role="teacher" title={viewedEntry.label} overrideDir={lesson.curtain ? lesson.curtain.override : null} />;
    } else {
      isStage = true;
      const showDemo = viewMode === 'demo' && hasDemo;
      isStatsView = !showDemo;
      dataView = isStatsView ? (viewMode === 'table' ? 'table' : 'stats') : null;
      if (showDemo && !legacyDemo) {
        // 演示视图 = 该段学生页（教师演示模式：本地记录、不发事件）；key 按段，换段重新挂载
        content = (
          <DemoProvider key={viewedEntry.id} stageId={viewedEntry.id}>
            <StageStudentView stageId={viewedEntry.id} />
          </DemoProvider>
        );
      } else {
        const Comp = showDemo ? legacyDemo : viewedEntry.TeacherStats;
        content = Comp ? (
          <PageStageContext.Provider value={{ view: dataView ?? 'demo', config: viewedEntry.config }}>
            <Comp />
          </PageStageContext.Provider>
        ) : null;
      }
    }
  }

  const slotStageId = viewedEntry ? viewedEntry.id : null;
  const slotIsLive = !isReviewing;
  const mainArea = wrapTeacherMain(components, content, { stageId: slotStageId, isLive: slotIsLive, viewMode });
  // 明细表通栏（T9a §2.3）：不带 teacherSidebar
  const hasSidebar = dataView === 'stats' && slotProviders(components, 'teacherSidebar').length > 0;
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
    </>
  );

  const banner = [
    everJoined && !joined && (
      <div key="reconnecting" data-testid="reconnecting" role="status" style={{ ...bannerBase, background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 }}>
        重连中…
      </div>
    ),
    toast && (
      <div key="toast" data-testid="validation-error" role="alert" style={{ ...bannerBase, background: 'var(--bad-soft)', color: 'var(--bad)', fontWeight: 600 }}>
        {toast}
      </div>
    ),
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

  // T9a §2.2：TeacherActions（可选导出）在三个视图的操作条左组、Page.Actions 之后；带阶段信息（原语的 useTeacherStage() 不写 id 也能取到）
  const TeacherActions = isStage && viewedEntry ? viewedEntry.TeacherActions : null;
  const actionsAfterPage = TeacherActions ? (
    <PageStageContext.Provider key="teacher-actions" value={{ view: dataView ?? 'demo', config: viewedEntry.config }}>
      <TeacherActionsBoundary>
        <TeacherActions stageId={viewedEntry.id} />
      </TeacherActionsBoundary>
    </PageStageContext.Provider>
  ) : null;

  const actionsStart = [
    isStage && (
      <div key="toggle" data-testid="view-toggle-wrap" style={{ flexShrink: 0 }}>
        <ViewToggle value={viewMode} onChange={setViewMode} short={narrow} items={VIEW_ITEMS} />
      </div>
    ),
    !narrow && hasToolbar && <Fragment key="toolbar">{toolbar}</Fragment>,
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
        actionsAfterPage={actionsAfterPage}
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
