// 覆盖层栈（界面整理规格 §2.3；契约 v0.7.2 §十）：Overlay 的共享状态，外壳内部件，不公开。
// - zIndex：按打开顺序递增（1000 + 序号），后开的在上；不按组件或 lesson.config 顺序
// - 背景 inert：栈里最上层的 dialog / panel / drawer 打开时，它（及它之上的弹层）以外的页面加 inert；
//   只动自己加的 inert，外壳 / 阶段自己加的（回看锁等）不碰；menu 不锁背景
// - Esc：document 冒泡阶段一个监听，只交给栈顶；栈顶没有 onDismiss 时什么也不做（不穿透到下层）；
//   内容已处理（defaultPrevented）时跳过；处理后 stopImmediatePropagation，组件不必再自己监听 Esc
// - 栈按 z 升序（插入排序），栈顶 = z 最大者
// - 焦点：打开时若自己是栈顶则移入（首个按钮 / 链接；没有或首个可聚焦元素是输入框时聚焦内容容器，避免平板弹出软键盘）；
//   关闭时若焦点还在弹层里（或已丢失），依次还给打开前的元素、打开时记下的外层弹层触发元素；输入框一律跳过
// - 镜像（MirrorContext）里的 Overlay 不经这里：就地渲染在镜像的 inert 子树里，不入栈、不移焦点、不加 inert
import { createContext } from 'react';

// 外壳的字号作用域：Shell 提供 role，Overlay 挂到 body 后仍带上 .teacher-app（教师投影字号）
export const OverlayScopeContext = createContext(null);
// 外层弹层：{ childOpened(), returnTarget() }；Fill 探针等由 Overlay 自己重置
export const OverlayParentContext = createContext(null);

let seq = 0;
const stack = [];
const inerted = new Set();
let listening = false;

export function nextZ() {
  seq += 1;
  return 1000 + seq;
}

function isModal(variant) {
  return variant === 'dialog' || variant === 'panel' || variant === 'drawer';
}

function applyInert() {
  for (const el of inerted) el.removeAttribute('inert');
  inerted.clear();
  if (typeof document === 'undefined') return;
  let top = -1;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (isModal(stack[i].variant)) { top = i; break; }
  }
  if (top < 0) return;
  const keep = new Set();
  for (let i = top; i < stack.length; i += 1) {
    for (let n = stack[i].node; n && n !== document.body && n !== document.documentElement; n = n.parentElement) keep.add(n);
  }
  for (const n of keep) {
    const parent = n.parentElement;
    if (!parent) continue;
    for (const sib of parent.children) {
      if (keep.has(sib) || sib.hasAttribute('inert') || sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') continue;
      sib.setAttribute('inert', '');
      inerted.add(sib);
    }
  }
}

function onKeyDown(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  const dismiss = top.dismiss();
  if (typeof dismiss !== 'function') return;
  e.stopImmediatePropagation();
  dismiss();
}

// entry: { node, variant, z, dismiss: () => onDismiss | undefined }；返回出栈函数
// 按 z 插入（升序），栈顶就是 z 最大者：同一次提交里嵌套打开时父先取 z（渲染）、子先入栈（effect），不能按入栈先后
export function pushOverlay(entry) {
  if (!listening && typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
    listening = true;
  }
  let i = stack.length;
  while (i > 0 && (stack[i - 1].z ?? 0) > (entry.z ?? 0)) i -= 1;
  stack.splice(i, 0, entry);
  applyInert();
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    applyInert();
  };
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const TEXT_ENTRY = /^(INPUT|TEXTAREA|SELECT)$/;

export function isTopOverlay(entry) {
  return stack.length > 0 && stack[stack.length - 1] === entry;
}

const isTextEntry = (el) => TEXT_ENTRY.test(el.tagName) || el.isContentEditable;

export function focusInto(box) {
  if (!box || typeof document === 'undefined') return;
  if (box.contains(document.activeElement)) return; // 内容自己已聚焦（如 autoFocus）
  const first = box.querySelector(FOCUSABLE);
  const target = first && !isTextEntry(first) ? first : box;
  try {
    target.focus({ preventScroll: true });
  } catch (_) {
    // 忽略
  }
}

// 关闭时还焦点：只在焦点仍在弹层里或已丢失（body / 已不在文档里）时还，不抢别处（如子弹层）已拿到的焦点
export function restoreFocus(box, targets) {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  const lost = !active || active === document.body || !active.isConnected || (box && box.contains(active));
  if (!lost) return;
  for (const t of targets) {
    // 输入框不还焦点（与打开时的取舍一致：程序聚焦输入框会在 Android 平板弹出软键盘）
    if (!t || !t.isConnected || typeof t.focus !== 'function' || isTextEntry(t)) continue;
    try {
      t.focus({ preventScroll: true });
    } catch (_) {
      continue;
    }
    if (document.activeElement === t) return;
  }
}
