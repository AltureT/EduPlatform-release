// 覆盖层（界面整理规格 §2.3）：唯一允许 position: fixed 的地方。外层 fixed inset 0（点遮罩关闭），
// 内容 max-height 不超过 100dvh，超出时内部滚动。
// variant：
//   dialog（缺省）居中、最大宽 520、文字居中（登录确认、释放绑定等）
//   panel  居中、最大宽 1100（详情弹窗）
//   drawer 贴底的抽屉（教师统计侧栏在 narrow 时）
//   menu   贴顶的下拉（narrow 时的阶段导航 / 步骤条）
// U4（契约 v0.7.2 §十）：
// - portal 挂到 document.body（隐藏态 open={false} 同样），不受祖先 display: none / overflow 影响；
//   在外壳里时带上外壳的字号作用域（教师端 .teacher-app）
// - zIndex 按打开顺序递增（后开的在上）；dialog / panel / drawer 打开时背景 inert；Esc 只由最上层处理（调它的 onDismiss）
// - 打开时焦点移入，关闭后还给触发元素（见 overlayStack.js）
// - 在镜像（MirrorContext）里：就地渲染、不入栈、不移焦点、不加 inert（留在镜像的 inert 子树里）
// - menu 形态：子树里另一个 Overlay 打开时自动调自己的 onDismiss（例："更多 ▾"里的组件打开抽屉，菜单随之关闭）
import { useContext, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FillProbeContext } from '../layout/pageContext.js';
import { MirrorContext } from '../mirror/mirrorContext.js';
import {
  OverlayParentContext, OverlayScopeContext, focusInto, isTopOverlay, nextZ, pushOverlay, restoreFocus,
} from './overlayStack.js';

const PLACE = {
  dialog: { align: 'center', maxWidth: 520, pad: 'var(--sp-5)' },
  panel: { align: 'center', maxWidth: 1100, pad: 'var(--sp-5)' },
  drawer: { align: 'flex-end', maxWidth: '100%', pad: 0 },
  menu: { align: 'flex-start', maxWidth: '100%', pad: 0 },
};

// fill（v0.7.1，界面整理规格 v0.2.2 §2.3）：内层高度取可用最大值（100dvh 减边距）、宽度取最大（min(1100px, 96vw)），
//   纵向 flex，里面的 <Fill> 可撑满；用于教师全屏镜像 / 聚焦（组件不得自己写 dvh）
// open（缺省 true）：false 时整棵保持挂载但隐藏（display: none，不是 fixed、不是对话框）；用于菜单里放着需要常驻的组件
export default function Overlay({ children, onDismiss, testId, variant = 'dialog', label, fill = false, open = true }) {
  const p = fill ? { ...(PLACE[variant] || PLACE.dialog), align: 'center', pad: 'var(--sp-5)' } : (PLACE[variant] || PLACE.dialog);
  const kind = PLACE[variant] ? variant : 'dialog';
  const edge = !fill && (kind === 'drawer' || kind === 'menu');
  const scope = useContext(OverlayScopeContext);
  const parent = useContext(OverlayParentContext);
  // 镜像里（教师看某生画面）：弹层留在镜像的 inert 子树里就地渲染，不走 portal、不入栈、不移焦点、不加 inert
  const inMirror = useContext(MirrorContext) != null;

  const rootRef = useRef(null);
  const boxRef = useRef(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const openRef = useRef(open);
  openRef.current = open;
  const returnRef = useRef(null);
  // 打开时记下外层弹层的触发元素：外层（如"更多 ▾"菜单）会因本弹层打开而关闭并清空自己的 returnRef，关闭时再问就拿不到了
  const fallbackRef = useRef(null);

  // 打开顺序决定层级：每次由关到开取一个新序号
  const zRef = useRef(null);
  if (open && zRef.current == null) zRef.current = nextZ();
  if (!open) zRef.current = null;

  const ctx = useMemo(() => ({
    childOpened() {
      if (kind === 'menu' && openRef.current && typeof dismissRef.current === 'function') dismissRef.current();
    },
    returnTarget() {
      return returnRef.current || fallbackRef.current || (parent ? parent.returnTarget() : null);
    },
  }), [kind, parent]);

  useEffect(() => {
    if (!open || inMirror) return undefined;
    const box = boxRef.current;
    returnRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    fallbackRef.current = parent ? parent.returnTarget() : null;
    const entry = { node: rootRef.current, variant: kind, z: zRef.current, dismiss: () => dismissRef.current };
    const pop = pushOverlay(entry);
    // 同一次提交里嵌套打开时，外层的 effect 晚于内层：只有栈顶才移焦点，不抢内层已拿到的焦点
    if (isTopOverlay(entry)) focusInto(box);
    if (parent) parent.childOpened();
    return () => {
      pop();
      restoreFocus(box, [returnRef.current, fallbackRef.current]);
      returnRef.current = null;
      fallbackRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, inMirror]);

  const node = (
    <div
      ref={rootRef}
      className={scope === 'teacher' ? 'teacher-app' : undefined}
      data-testid={testId}
      data-overlay={variant}
      data-fill={fill ? 'true' : undefined}
      data-open={open ? 'true' : 'false'}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-hidden={open ? undefined : 'true'}
      aria-label={label}
      onClick={open ? onDismiss : undefined}
      style={open ? {
        position: 'fixed', inset: 0,
        background: 'var(--overlay)',
        display: 'flex', alignItems: p.align, justifyContent: 'center',
        zIndex: zRef.current, padding: p.pad,
      } : { display: 'none' }}
    >
      <div
        ref={boxRef}
        data-overlay-box=""
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          borderRadius: variant === 'drawer'
            ? 'var(--radius) var(--radius) 0 0'
            : variant === 'menu' ? '0 0 var(--radius) var(--radius)' : 'var(--radius)',
          boxShadow: 'var(--shadow)',
          padding: edge
            ? 'var(--sp-4)'
            : variant === 'panel' ? 'var(--sp-5)' : 'var(--sp-6) var(--sp-6)',
          maxWidth: fill ? 'min(1100px, 96vw)' : p.maxWidth,
          width: '100%',
          height: fill ? 'calc(100dvh - 2 * var(--sp-5))' : undefined,
          maxHeight: edge ? '100dvh' : 'calc(100dvh - 2 * var(--sp-5))',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: edge ? 'var(--sp-2)' : undefined,
          textAlign: variant === 'dialog' && !fill ? 'center' : undefined,
          outline: 'none',
        }}
      >
        <OverlayParentContext.Provider value={ctx}>
          <FillProbeContext.Provider value={null}>
            {children}
          </FillProbeContext.Provider>
        </OverlayParentContext.Provider>
      </div>
    </div>
  );

  if (inMirror || typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}

export function BigName({ children }) {
  return (
    <div style={{
      fontSize: 'var(--fs-display)',
      fontWeight: 700, color: 'var(--ink)',
      padding: 'var(--sp-4) var(--sp-5)',
      background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)',
      marginBottom: 'var(--sp-5)', letterSpacing: '0.02em',
    }}>{children}</div>
  );
}
