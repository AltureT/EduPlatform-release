// code / data-analysis 共用的"教师现场演示 · 下发给学生"（教师现场演示规格 §3、§5，P7）。只给原语作者用。
//
//   服务端：ctx.on('teacher:push-code', pushCodeShape, (s, p) => ctx.data.setClass(pushedPatch(p, Date.now())))
//           teacher:push-code { code | null }：code 为字符串（0–20000 字）→ perClass.pushedCode = { code, at }；null / 缺省 → null（撤回）
//           defaults.onLeave: clearPushed —— 段切换时清掉（classroom:reset 由内核清阶段数据）
//   学生端：pushedOf(classData) → { code, at } | null；采用标记见 sandbox 的 draftStorage（pushedKey / readPushed / writePushed）
//   记录：学生采用后两个学生事件带 fromTeacher: true（服务端只在为 true 时写进记录顶层，历史标记）
// 模块顶层无副作用，Node 与浏览器都能用（schema.js 无 Node 依赖）。
import { shape } from '#kernel/server/schema.js';

export const PUSHED_MAX = 20000;
export const pushCodeShape = shape({ code: `optional:string:0-${PUSHED_MAX}` });
export const pushedPatch = (p, now) => ({ pushedCode: typeof p?.code === 'string' ? { code: p.code, at: now } : null });

// defaults.onLeave 工厂：(options) => (ctx) => …；没有下发时不写（不多发一次 class-update）
export const clearPushed = () => (ctx) => {
  if (ctx.data.getClass()?.pushedCode != null) ctx.data.setClass({ pushedCode: null });
};

// 多份起始代码（code）时，学生在选择页选"老师刚发的"记的 starterLabel
export const PUSHED_LABEL = '老师下发';

// 班级记录里的下发：形状对才返回 { code, at }
export function pushedOf(classData) {
  const p = classData?.pushedCode;
  return p && typeof p === 'object' && typeof p.code === 'string' && typeof p.at === 'number' ? p : null;
}
