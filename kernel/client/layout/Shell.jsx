// 外壳（界面整理规格 §2.2）：教师端与学生端共用。100dvh 网格四行：顶栏 / 横幅区 / 内容 / 操作条。
// - 横幅区与操作条没有内容时不渲染（高度 0）；各区域显式放到自己的网格行
// - 内容区 min-height: 0；教师端 overflow: auto，学生端 overflow: hidden（由阶段内容用 <Page> / <Fill> 分配高度）
// - 操作条是网格的一行，不是 position: fixed。内容：外壳自己的项（actionsStart / actionsEnd）+ 内容区里
//   <Page.Actions> 经 sink 登记的项（pageActionsAt 决定放左组还是右组）
// - sink：缺省由 Shell 自建并向内容区提供；学生端 live / 回看两个窗格各有一个，由调用方传入当前可见的那个
// - U4：向整棵外壳提供 OverlayScopeContext（role），外壳里的 Overlay 挂到 body 后仍带外壳的字号作用域
import { Children, Fragment, useState, useSyncExternalStore } from 'react';
import { ActionSinkContext, createActionSink } from './actionSink.js';
import { OverlayScopeContext } from '../shells/overlayStack.js';

function ActionBar({ sink, start, end, pageAt, inert }) {
  useSyncExternalStore(sink.subscribe, sink.getVersion, sink.getVersion);
  const pageNodes = sink.nodes().map(([id, node]) => <Fragment key={id}>{node}</Fragment>);
  const s = [...Children.toArray(start), ...(pageAt === 'start' ? pageNodes : [])];
  const e = [...(pageAt === 'end' ? pageNodes : []), ...Children.toArray(end)];
  if (s.length === 0 && e.length === 0) return null;
  return (
    <div
      data-shell-region="actionbar"
      inert={inert || undefined}
      style={{
        gridRow: 4,
        height: 'var(--actionbar-h)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--sp-3)',
        padding: '0 var(--sp-4)',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border-strong)',
        minWidth: 0,
      }}
    >
      <div data-actionbar="start" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 0, flex: '1 1 auto', overflowX: 'auto' }}>
        {s}
      </div>
      <div data-actionbar="end" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 }}>
        {e}
      </div>
    </div>
  );
}

export default function Shell({
  role = 'student',
  header,
  banner,
  actionsStart,
  actionsEnd,
  sink: externalSink,
  pageActionsAt = 'end',
  inertActions = false,
  testId,
  children,
}) {
  const [ownSink] = useState(createActionSink);
  const sink = externalSink || ownSink;
  const banners = Children.toArray(banner);
  const content = externalSink ? children : (
    <ActionSinkContext.Provider value={ownSink}>{children}</ActionSinkContext.Provider>
  );
  // U4：外壳里的 Overlay 挂到 body 后仍带外壳的字号作用域（教师端 .teacher-app）
  return (
    <OverlayScopeContext.Provider value={role}>
      <div
        data-testid={testId}
        data-shell={role}
        className={role === 'teacher' ? 'teacher-app' : 'student-app'}
        style={{
          display: 'grid',
          gridTemplateRows: 'var(--header-h) auto minmax(0, 1fr) auto',
          gridTemplateColumns: 'minmax(0, 1fr)',
          height: '100dvh',
          overflow: 'hidden',
          background: 'var(--bg)',
          width: '100%',
        }}
      >
        <header
          data-shell-region="header"
          style={{
            gridRow: 1,
            height: 'var(--header-h)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--sp-3)',
            padding: '0 var(--sp-4)',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            minWidth: 0,
            position: 'relative',
            zIndex: 2,
          }}
        >
          {header}
        </header>
        {banners.length > 0 && (
          // 横幅区不超过视口 40%，超出时内部滚动（保证内容区仍有高度；网格 auto 行里百分比 max-height 无从解析，故用 dvh）
          <div data-shell-region="banner" style={{ gridRow: 2, display: 'flex', flexDirection: 'column', minWidth: 0, maxHeight: '40dvh', overflow: 'auto' }}>
            {banners}
          </div>
        )}
        <main
          data-shell-region="content"
          style={{
            gridRow: 3,
            minHeight: 0,
            minWidth: 0,
            overflow: role === 'teacher' ? 'auto' : 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {content}
        </main>
        <ActionBar sink={sink} start={actionsStart} end={actionsEnd} pageAt={pageActionsAt} inert={inertActions} />
      </div>
    </OverlayScopeContext.Provider>
  );
}
