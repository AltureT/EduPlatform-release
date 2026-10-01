// <Page template title hint>（界面整理规格 §3.5）：每个阶段视图的根。模板 focus | split | tiles | table | stack，
// 命名区域 Page.Main / Page.Side / Page.Aside / Page.Actions。区域有可见边界：标题区底线、侧区浅底、操作条顶线。
// - template 缺省取外壳提供的阶段信息（学生视图 = stage.config.layout，缺省 focus；教师演示 focus；统计 table）；
//   学生视图里显式 template 与 stage.config.layout（缺省 focus）不一致时 console.warn，以 <Page> 为准
// - Page.Actions 的内容登记到外壳操作条（ActionSinkContext）；没有外壳（测试、组件内）或处于镜像内时就地渲染在页尾
// - 所有模板的 Main 区都是 flex: 1、纵向 flex、min-height: 0，内容里的 <Fill> 能撑到可用高度
// - split 没有 Page.Side 时不分栏，Main 占满全宽（有 Page.Side 但内容为空时才是空占位）
// - P3：split 的 ratio（Main : Side，缺省 '3:2'）；窄屏的学生视图（外壳 PageStageContext.view === 'student'，含镜像）里
//   Side 排在 Main 之上并可折叠：顶部一行"<sideLabel> ▾ / ▸"（sideLabel 缺省"题目"），缺省展开，折叠状态记在 sessionStorage（键 page-side:<阶段 id>）；
//   宽屏与外壳页面（登录页等）不变。换位用带 key 的子节点，Main 不重新挂载
// - K10：split 窄屏顺序由 narrowOrder 决定：'side-first'（缺省，Side 在上）| 'main-first'（外壳页面登录页 / 教师课前页传这个）；
//   有阶段信息（PageStageContext）的视图窄屏上下排时 Main 撑满剩余高度、Side 按内容高至多一半（Split stack="fill-last" / "fill-first"），
//   外壳页面仍按内容高、整体滚动（stack="auto"）
// - P5（代码段布局与回看规格 §4）：split 的 side='right'（缺省）| 'left'：left 时宽屏顺序 [Side, Main]，传给 Split 的 ratio 反转
//   （ratio 写的仍是 Main : Side）；窄屏顺序不变。resizable 透传给 Split，storageKey 由 Page 生成：
//   page-split:<lessonId>:<config.primitive ?? config.id>（lessonId 由外壳经 PageStageContext 提供；拿不到就不带 storageKey，只在内存里记）
// - focus：Main 水平居中、最大宽 960，内容顶对齐放在可见面板里；教师演示视图保持纵向居中、不加面板（规格 v0.2.1）；
//   U4：面板里没有 <Fill> 时按内容高，有 <Fill> 时撑满
// - table 模板在 narrow 时 Side 收进操作条上 "推荐 ▾" 打开的底部抽屉；没有 Page.Side 时不渲染 300 px 空侧区
//   （外壳只在有 teacherSidebar 提供者时传 Side）
// - C5（课程本地组件规格 §3）：学生视图（PageStageContext.view === 'student'，含镜像）里渲染组件槽位 studentAside：
//   split 有 Side 时放在 Side 内容之后，其余模板（含 split 无 Side / 窄屏 Side 为空）放在 Main 内容之后；
//   props { stageId: config.id, isLive: PageStageContext.isLive（缺省 true） }；无提供者不渲染任何包裹元素
// - Actions 的内容渲染在外壳操作条的位置：拿得到内核的 context，拿不到阶段在 <Page> 里面自己包的 Context
import { Children, Fragment, isValidElement, useCallback, useContext, useEffect, useState } from 'react';
import { MirrorContext } from '../mirror/mirrorContext.js';
import { useKernelRole } from '../hooks/roleContext.js';
import Overlay from '../shells/Overlay.jsx';
import Btn from '../ui/Btn.jsx';
import Split from './Split.jsx';
import { useNarrow } from './useNarrow.js';
import { pickProps, cx } from './props.js';
import { ActionSinkContext, useActionSink } from './actionSink.js';
import { FillProbeContext, PageStageContext, TEMPLATES, defaultTemplateOf } from './pageContext.js';
import { StudentAside } from '../shells/ComponentSlots.jsx';

function Main() { return null; }
function Side() { return null; }
function Aside() { return null; }
function Actions() { return null; }
Main.displayName = 'Page.Main';
Side.displayName = 'Page.Side';
Aside.displayName = 'Page.Aside';
Actions.displayName = 'Page.Actions';

function collect(children, out) {
  Children.forEach(children, (c) => {
    if (c == null || c === false || c === true) return;
    if (isValidElement(c) && c.type === Fragment) {
      collect(c.props.children, out);
      return;
    }
    if (isValidElement(c) && c.type === Main) out.main.push(c.props.children);
    else if (isValidElement(c) && c.type === Side) { out.hasSide = true; out.side.push(c.props.children); }
    else if (isValidElement(c) && c.type === Aside) out.aside.push(c.props.children);
    else if (isValidElement(c) && c.type === Actions) out.actions.push(c.props.children);
    else out.main.push(c); // 区域外的内容视为 Main
  });
  return out;
}

const hasContent = (list) => list.some((x) => x != null && x !== false && !(Array.isArray(x) && x.length === 0));

const regionScroll = {
  minHeight: 0,
  minWidth: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

// panel：focus 模板（非演示视图）的可见面板——surface 底、细边、圆角，内容顶对齐（规格 v0.2.1 §3.5）
// U4：面板里没有 <Fill> 时按内容高——真正控制高度的是 flex: 0 1 auto（不放大；内容超高时仍可缩小并内部滚动）；
//   align-self: flex-start 在纵向 flex 里只管水平方向，宽度由 width: 100% / maxWidth 决定，这里只是不拉伸的附带声明；
//   有 <Fill>（任意深度，经 FillProbeContext 登记；Overlay 与其它 Main 区挡住）时撑满可用高度
// 每个 Main 区都重新提供 FillProbeContext：非面板区提供 null，里面嵌套的 <Page> / <Fill> 不会登记到外层面板
function MainRegion({ children, center = false, max = null, panel = false }) {
  const [fills, setFills] = useState(0);
  const probe = useCallback(() => {
    setFills((n) => n + 1);
    return () => setFills((n) => n - 1);
  }, []);
  const fit = panel ? (fills > 0 ? 'fill' : 'content') : undefined;
  return (
    <div
      data-page-region="main"
      data-panel={panel ? '' : undefined}
      data-fit={fit}
      style={{
        ...regionScroll,
        flex: fit === 'content' ? '0 1 auto' : '1 1 0%',
        alignSelf: fit === 'content' ? 'flex-start' : undefined,
        width: '100%',
        maxWidth: max ?? undefined,
        marginLeft: max ? 'auto' : undefined,
        marginRight: max ? 'auto' : undefined,
        gap: 'var(--sp-4)',
        background: panel ? 'var(--surface)' : undefined,
        border: panel ? '1px solid var(--border)' : undefined,
        borderRadius: panel ? 'var(--radius)' : undefined,
        boxShadow: panel ? 'var(--shadow-soft)' : undefined,
        padding: panel ? 'var(--sp-5)' : undefined,
      }}
    >
      <FillProbeContext.Provider value={panel ? probe : null}>
        {center ? (
          // 教师演示视图：内容短时纵向居中；内容长时撑高后由 Main 滚动（不会被裁掉）；里面的 <Fill> 仍能占满剩余高度
          <div data-page-center="" style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--sp-4)', minWidth: 0 }}>
            {children}
          </div>
        ) : children}
      </FillProbeContext.Provider>
    </div>
  );
}

// 窄屏折叠 Side 的记忆（sessionStorage；不可用时只在内存里）
const sideKeyOf = (stageCtx) => (stageCtx && stageCtx.config && stageCtx.config.id != null ? `page-side:${stageCtx.config.id}` : null);
function readSideOpen(key) {
  if (!key) return true;
  try {
    return globalThis.sessionStorage?.getItem(key) !== 'collapsed';
  } catch (_) {
    return true;
  }
}
function writeSideOpen(key, open) {
  if (!key) return;
  try {
    globalThis.sessionStorage?.setItem(key, open ? 'open' : 'collapsed');
  } catch (_) {
    // 隐私模式等：只在内存里记
  }
}

const foldBtn = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: 'var(--control-h-sm)',
  flexShrink: 0,
  padding: 0,
  background: 'none',
  border: 'none',
  font: 'inherit',
  fontWeight: 600,
  color: 'var(--ink)',
  textAlign: 'left',
  cursor: 'pointer',
};

function SideRegion({ children, empty, fold = null, label = '题目' }) {
  return (
    <div
      data-page-region="side"
      data-empty={empty ? 'true' : undefined}
      data-folded={fold ? (fold.open ? 'false' : 'true') : undefined}
      style={{
        ...regionScroll,
        flex: '1 1 0%',
        gap: 'var(--sp-3)',
        background: 'var(--surface-alt)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-3)',
      }}
    >
      {fold && (
        <button type="button" data-testid="page-side-toggle" aria-expanded={fold.open} onClick={fold.toggle} style={foldBtn}>
          {`${label} ${fold.open ? '▾' : '▸'}`}
        </button>
      )}
      {(!fold || fold.open) && children}
    </div>
  );
}

function AsideRegion({ children }) {
  return (
    <div
      data-page-region="aside"
      style={{
        flexShrink: 0,
        color: 'var(--ink-soft)',
        fontSize: 'var(--fs-sm)',
        borderTop: '1px dashed var(--border)',
        paddingTop: 'var(--sp-2)',
        maxHeight: '30%',
        overflow: 'auto',
      }}
    >
      {children}
    </div>
  );
}

// 'a:b' → 'b:a'（认不出的原样返回，由 Split 按 1:1 处理）
function reverseRatio(ratio) {
  const m = /^\s*([^:\s]+)\s*:\s*([^:\s]+)\s*$/.exec(String(ratio ?? ''));
  return m ? `${m[2]}:${m[1]}` : ratio;
}

// 拖宽比例的记忆键：原语段按原语类型（同类段共用一份宽度），自写段按阶段 id；没有 lessonId / 阶段信息时不记
function splitKeyOf(stageCtx) {
  const lessonId = stageCtx && stageCtx.lessonId;
  const cfg = stageCtx && stageCtx.config;
  if (lessonId == null || lessonId === '' || !cfg) return undefined;
  const part = cfg.primitive ?? cfg.id;
  if (part == null || part === '') return undefined;
  return `page-split:${lessonId}:${part}`;
}

export default function Page({
  template, title, hint, ratio = '3:2', side = 'right', narrowOrder = 'side-first', resizable = false, sideLabel = '题目', children, ...rest
}) {
  const p = pickProps(rest, 'Page');
  const stageCtx = useContext(PageStageContext);
  const sink = useContext(ActionSinkContext);
  const inMirror = useContext(MirrorContext) != null;
  const role = useKernelRole();
  const narrow = useNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sideKey = sideKeyOf(stageCtx);
  const [sideOpen, setSideOpen] = useState(() => readSideOpen(sideKey));
  useEffect(() => { setSideOpen(readSideOpen(sideKey)); }, [sideKey]);
  const toggleSide = useCallback(() => {
    setSideOpen((open) => {
      writeSideOpen(sideKey, !open);
      return !open;
    });
  }, [sideKey]);

  const fallback = defaultTemplateOf(stageCtx);
  const valid = template == null || TEMPLATES.includes(template);
  const t = template != null && valid ? template : fallback;

  const configLayout = stageCtx && stageCtx.view === 'student'
    ? ((stageCtx.config && stageCtx.config.layout) || 'focus')
    : null;
  useEffect(() => {
    if (!valid) console.warn(`[Page] 未知模板 "${template}"，只能是 ${TEMPLATES.join(' / ')}；已按 ${fallback} 渲染`);
    else if (template != null && configLayout != null && template !== configLayout) {
      console.warn(`[Page] template="${template}" 与 stage.config.js 的 layout "${configLayout}" 不一致，以 <Page> 为准`);
    }
  }, [template, valid, configLayout, fallback]);

  const r = collect(children, { main: [], side: [], aside: [], actions: [], hasSide: false });
  const sideDrawer = t === 'table' && narrow && r.hasSide;
  const pageActions = hasContent(r.actions) ? r.actions : null;
  const actionsNode = pageActions || sideDrawer ? (
    <>
      {sideDrawer && (
        <Btn variant="soft" data-testid="page-side-drawer" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
          推荐 ▾
        </Btn>
      )}
      {pageActions}
    </>
  ) : null;
  const inline = inMirror || !sink;
  useActionSink(inline ? null : sink, actionsNode);

  const sideEmpty = !hasContent(r.side);
  const asideNode = stageCtx && stageCtx.view === 'student'
    ? <StudentAside stageId={stageCtx.config && stageCtx.config.id != null ? stageCtx.config.id : null} isLive={stageCtx.isLive !== false} />
    : null;
  let body;
  if (t === 'split') {
    // 没有 Page.Side 时不分栏：Main 占满全宽（wide / narrow 都一样），不留 40% 空区
    // narrow 时 Side 内容为空也只渲染 Main（wide 时保留空占位，框架不塌陷）。
    // 始终是同一个 <Split>，只用 single 切单列：Main 在树里的位置不变，切换时不会重新挂载（草稿 / 光标 / 撤销历史不丢）
    const showSide = r.hasSide && !(narrow && sideEmpty);
    const foldable = showSide && narrow && !!stageCtx && stageCtx.view === 'student';
    const mainEl = <MainRegion key="main">{r.main}{showSide ? null : asideNode}</MainRegion>;
    const sideEl = showSide
      ? <SideRegion key="side" empty={sideEmpty} fold={foldable ? { open: sideOpen, toggle: toggleSide } : null} label={sideLabel}>{r.side}{asideNode}</SideRegion>
      : null;
    // side="left"：宽屏 [Side, Main]、ratio 反转；窄屏顺序只看 narrowOrder（缺省 Side 在上）
    const wideSideFirst = side === 'left' && !narrow;
    const sideFirst = narrow ? narrowOrder !== 'main-first' : wideSideFirst;
    // K10：阶段视图窄屏上下排时 Main 撑满剩余高度（Split 断点与 useNarrow 同为 900）
    const fillStack = narrow && showSide && !!stageCtx ? (sideFirst ? 'fill-last' : 'fill-first') : 'auto';
    body = (
      <Split
        ratio={wideSideFirst ? reverseRatio(ratio) : ratio}
        stack={fillStack}
        single={!showSide}
        resizable={!!resizable}
        storageKey={resizable ? splitKeyOf(stageCtx) : undefined}
      >
        {sideFirst ? [sideEl, mainEl] : [mainEl, sideEl]}
      </Split>
    );
  } else if (t === 'table') {
    body = (
      <div
        data-page-body-grid=""
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: narrow || !r.hasSide ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 300px',
          gridTemplateRows: 'minmax(0, 1fr)',
        }}
      >
        <MainRegion>{r.main}{asideNode}</MainRegion>
        {!narrow && r.hasSide && <SideRegion empty={sideEmpty}>{r.side}</SideRegion>}
      </div>
    );
  } else if (t === 'tiles') {
    body = (
      <MainRegion>
        {/* 同一个网格容器，narrow 只把列改成单列（不换组件类型，转屏时磁贴不重新挂载） */}
        <div
          data-ly="tiles"
          style={{
            display: 'grid',
            gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(var(--tile-min, 260px), 1fr))',
            alignContent: 'start',
            gap: 'var(--sp-4)',
            minWidth: 0,
          }}
        >
          {r.main}
        </div>
        {asideNode}
      </MainRegion>
    );
  } else if (t === 'stack') {
    body = (
      <MainRegion max={960}>
        {/* 单列容器纵向撑满 Main，里面的 <Fill> 可撑到可用高度 */}
        <div data-ly="stack" style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', minWidth: 0 }}>
          {r.main}
          {asideNode}
        </div>
      </MainRegion>
    );
  } else {
    const demo = !!stageCtx && stageCtx.view === 'demo';
    body = demo
      ? <MainRegion center max={960}>{r.main}</MainRegion>
      : <MainRegion panel max={960}>{r.main}{asideNode}</MainRegion>;
  }

  // T9a 审查：教师演示模式（演示视图 = 学生页）标题字号按学生端算，与学生看到的一致
  const demoView = !!stageCtx && stageCtx.demo === true;
  const titleSize = role === 'teacher' && !inMirror && !demoView ? 'var(--heading, var(--fs-xl))' : 'var(--fs-xl)';

  return (
    <div
      {...p}
      className={cx('page', `page--${t}`, p.className)}
      data-page={t}
      style={{
        flex: '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {(title != null || hint != null) && (
        <div
          data-page-region="title"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 'var(--sp-1) var(--sp-3)',
            padding: 'var(--sp-3) var(--sp-4)',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          {title != null && (
            <h1 style={{ fontSize: titleSize, fontWeight: 700, lineHeight: 1.25, color: 'var(--ink)', minWidth: 0 }}>{title}</h1>
          )}
          {hint != null && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-soft)' }}>{hint}</div>
          )}
        </div>
      )}
      <div
        data-page-region="body"
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-4)',
        }}
      >
        {body}
        {hasContent(r.aside) && <AsideRegion>{r.aside}</AsideRegion>}
      </div>
      {inline && actionsNode && (
        <div
          data-page-region="actions"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            gap: 'var(--sp-2)',
            padding: 'var(--sp-3) var(--sp-4)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {actionsNode}
        </div>
      )}
      {sideDrawer && drawerOpen && (
        <Overlay variant="drawer" testId="page-side-drawer-panel" onDismiss={() => setDrawerOpen(false)}>
          {r.side}
        </Overlay>
      )}
    </div>
  );
}

Page.Main = Main;
Page.Side = Side;
Page.Aside = Aside;
Page.Actions = Actions;
