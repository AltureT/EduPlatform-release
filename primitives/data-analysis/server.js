// data-analysis 原语的事件（活动原语规格 §3.5）
//   student:data-submit { 沙盒记录 }：学生视图每次运行结束后自动发（buildRecord，图 ≤ 1 张）；写记录 + submittedAt；
//                        本次有图且还没有 firstImageAt 时写 firstImageAt（只记一次，之后不覆盖）
//   student:data-final { 沙盒记录 }（P3）：学生点"上交最终稿"并确认；写 final { code, stdout, error, images, tests, at } 与 finalAt（覆盖式），
//                        自动记录的字段不动；载荷可带 stale: true（代码在最近一次运行后改过），写进 final.stale
//   teacher:feature { name | null }：把某生的图与代码投到大屏（perClass.featured）；该生须已有记录；null 取消
//   teacher:feature-next {}：在出过图的学生里按首次出图（firstImageAt）先后轮换到下一位（当前不在其中则从第一位开始）
//   P6（代码段教学功能规格 §2.2），有 solution 时注册：
//   teacher:show-solution { on }：只写 perClass.showSolution 布尔（大屏显示 / 隐藏参考答案，参考答案本身只在教师端 options 里）
//   teacher:publish-solution { on }：on → perClass { solution, solutionPublishedAt }（学生题目栏出现"参考答案"面板）；off → 两者清为 null
//   有 solution 时，公布中到达的 student:data-submit 写 afterSolution: true（其它情况不写，撤回后历史标记保留）；公布中到达的 student:data-final 写 final.afterSolution: true
import { shape } from '#kernel/server/schema.js';
import { recordShape, recordShapeWith } from '#components/sandbox/record-shape.js';
import { everImage, hasImage } from './primitive.config.js';

export function register(ctx, options) {
  const withSolution = !!options?.solution;
  const published = () => ctx.data.getClass()?.solutionPublishedAt != null;

  ctx.on('student:data-submit', recordShape, (socket, p, actor) => {
    const now = Date.now();
    const first = hasImage(p) && ctx.data.get(actor.name)?.firstImageAt == null ? { firstImageAt: now } : {};
    const mark = withSolution && published() ? { afterSolution: true } : {};
    ctx.data.set(actor.name, { ...p, submittedAt: now, ...first, ...mark });
  });

  ctx.on('student:data-final', recordShapeWith({ stale: 'optional:boolean' }), (socket, p, actor) => {
    const now = Date.now();
    const final = { code: p.code, stdout: p.stdout, error: p.error ?? null, images: p.images, tests: p.tests ?? null, at: now };
    if (p.stale === true) final.stale = true;
    if (withSolution && published()) final.afterSolution = true;
    ctx.data.set(actor.name, { final, finalAt: now });
  });

  ctx.on('teacher:feature', shape({ name: 'optional:string:1-64' }), (socket, p) => {
    const name = p.name ?? null;
    if (name != null && !ctx.data.get(name)) return ctx.reject(socket, `${name} 还没有运行记录`);
    ctx.data.setClass({ featured: name });
  });

  ctx.on('teacher:feature-next', shape({}), (socket) => {
    const list = Object.entries(ctx.data.all() ?? {})
      .filter(([, r]) => everImage(r))
      .sort((a, b) => a[1].firstImageAt - b[1].firstImageAt || a[0].localeCompare(b[0]))
      .map(([name]) => name);
    if (list.length === 0) return ctx.reject(socket, '还没有人出图');
    const i = list.indexOf(ctx.data.getClass().featured ?? null);
    ctx.data.setClass({ featured: list[(i + 1) % list.length] });
  });

  if (withSolution) {
    ctx.on('teacher:show-solution', shape({ on: 'boolean' }), (socket, p) => {
      ctx.data.setClass({ showSolution: p.on });
    });
    ctx.on('teacher:publish-solution', shape({ on: 'boolean' }), (socket, p) => {
      ctx.data.setClass(p.on
        ? { solution: options.solution, solutionPublishedAt: Date.now() }
        : { solution: null, solutionPublishedAt: null });
    });
  }
}
