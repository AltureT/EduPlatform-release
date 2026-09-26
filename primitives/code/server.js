// code 原语的事件（活动原语规格 §3.4）
//   student:code-submit { 沙盒记录 }：学生视图每次运行 / 测试结束后自动发（buildRecord）；写记录 + submittedAt，以最后一次为准；
//                        本次测试全过且还没有 firstPassedAt 时写 firstPassedAt（只记一次，之后不覆盖）
//   student:code-final { 沙盒记录 }（P3）：学生点"上交最终稿"并确认；写 final { code, stdout, error, images, tests, at } 与 finalAt（覆盖式），
//                        自动记录的字段（code / stdout / submittedAt / firstPassedAt …）不动；载荷可带 stale: true（代码在最近一次运行后改过）
//   teacher:feature { name | null }：把某生的代码与输出投到大屏（perClass.featured）；该生须已有记录；null 取消
//   teacher:show-solution { on }：有 solution 时注册；只写 perClass.showSolution 布尔，参考答案本身只在教师端的 options 里
import { shape } from '#kernel/server/schema.js';
import { recordShape, recordShapeWith } from '#components/sandbox/record-shape.js';
import { allPassed, finalPatch } from './record.js';

export function register(ctx, options) {
  ctx.on('student:code-submit', recordShape, (socket, p, actor) => {
    const now = Date.now();
    const first = allPassed(p.tests) && ctx.data.get(actor.name)?.firstPassedAt == null ? { firstPassedAt: now } : {};
    ctx.data.set(actor.name, { ...p, submittedAt: now, ...first });
  });

  ctx.on('student:code-final', recordShapeWith({ stale: 'optional:boolean' }), (socket, p, actor) => {
    ctx.data.set(actor.name, finalPatch(p, Date.now()));
  });

  ctx.on('teacher:feature', shape({ name: 'optional:string:1-64' }), (socket, p) => {
    const name = p.name ?? null;
    if (name != null && !ctx.data.get(name)) return ctx.reject(socket, `${name} 还没有运行记录`);
    ctx.data.setClass({ featured: name });
  });

  if (options.solution) {
    ctx.on('teacher:show-solution', shape({ on: 'boolean' }), (socket, p) => {
      ctx.data.setClass({ showSolution: p.on });
    });
  }
}
