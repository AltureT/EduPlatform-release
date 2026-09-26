// 加载失败提示的整页状态（studentOverlay 写、studentBanner 读；契约 v0.7.1 §八）
// { message: 文案或 null, hidden: 学生点了 [收起], retry: 重试函数或 null（浏览器太旧时为 null，不给 [重试]） }
// 模块顶层只有这份纯数据，无副作用
const INITIAL = Object.freeze({ message: null, hidden: false, retry: null });
let snap = INITIAL;
const listeners = new Set();

export function getLoadAlert() {
  return snap;
}

export function subscribeLoadAlert(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLoadAlert(patch) {
  const next = { ...snap, ...patch };
  if (next.message === snap.message && next.hidden === snap.hidden && next.retry === snap.retry) return;
  snap = Object.freeze(next);
  for (const l of [...listeners]) l();
}

export function __resetLoadAlertForTest() {
  snap = INITIAL;
  listeners.clear();
}
