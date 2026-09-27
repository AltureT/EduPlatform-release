// code 原语的事件（活动原语规格 §3.4）
//   student:code-submit { 沙盒记录 }：学生视图每次运行 / 测试结束后自动发（buildRecord）；写记录 + submittedAt，以最后一次为准；
//                        本次测试全过且还没有 firstPassedAt 时写 firstPassedAt（只记一次，之后不覆盖）
//   student:code-final { 沙盒记录 }（P3）：学生点"上交最终稿"并确认；写 final { code, stdout, error, images, tests, at } 与 finalAt（覆盖式），
//                        自动记录的字段（code / stdout / submittedAt / firstPassedAt …）不动；载荷可带 stale: true（代码在最近一次运行后改过）
//   teacher:feature { name | null }：把某生的代码与输出投到大屏（perClass.featured）；该生须已有记录；null 取消
//   teacher:show-solution { on }：有 solution 时注册；只写 perClass.showSolution 布尔（大屏显示 / 隐藏），参考答案本身只在教师端的 options 里
//   teacher:publish-solution { on }（P6，代码段教学功能规格 §2.2）：有 solution 时注册；on → 把参考答案写进班级记录
//                        perClass { solution, solutionPublishedAt }（学生题目栏出现"参考答案"面板）；off → 两者清为 null（撤回）；与 showSolution 独立
//   有 solution 时，公布中到达的 student:code-submit 在记录上写 afterSolution: true（其它情况不写该字段；记录是合并写入，
//                        所以撤回后再运行 true 仍保留——历史标记）；公布中到达的 student:code-final 写 final.afterSolution: true（final 整体覆盖）
//   P6（§4.3）：多份起始代码（options.starters）时两个学生事件都可带 starterLabel（1–12 字），是 starters 里的某个 label 才写进记录顶层
//                        （code-final 也写顶层，表示学生现在用的起点）；不认识的 label 丢掉不拒绝（旧页面 / 改过课也能照常记录）
import { shape } from '#kernel/server/schema.js';
import { recordShapeWith } from '#components/sandbox/record-shape.js';
import { allPassed, finalPatch } from './record.js';

const withLabel = { starterLabel: 'optional:string:1-12' };
const submitShape = recordShapeWith(withLabel);
const finalShape = recordShapeWith({ stale: 'optional:boolean', ...withLabel });

export function register(ctx, options) {
  const withSolution = !!options?.solution;
  const labels = new Set(Array.isArray(options?.starters) ? options.starters.map((s) => s.label) : []);
  // 载荷里的 starterLabel：认识的留下，其余去掉
  const labelOf = (p) => {
    const { starterLabel, ...rest } = p;
    return { rest, label: typeof starterLabel === 'string' && labels.has(starterLabel) ? { starterLabel } : {} };
  };
  // 参考答案是否正在公布（班级记录里有 solutionPublishedAt）
  const published = () => ctx.data.getClass()?.solutionPublishedAt != null;

  ctx.on('student:code-submit', submitShape, (socket, payload, actor) => {
    const { rest: p, label } = labelOf(payload);
    const now = Date.now();
    const first = allPassed(p.tests) && ctx.data.get(actor.name)?.firstPassedAt == null ? { firstPassedAt: now } : {};
    const mark = withSolution && published() ? { afterSolution: true } : {};
    ctx.data.set(actor.name, { ...p, submittedAt: now, ...first, ...mark, ...label });
  });

  ctx.on('student:code-final', finalShape, (socket, payload, actor) => {
    const { rest: p, label } = labelOf(payload);
    const patch = finalPatch(p, Date.now());
    if (withSolution && published()) patch.final.afterSolution = true;
    ctx.data.set(actor.name, { ...patch, ...label });
  });

  ctx.on('teacher:feature', shape({ name: 'optional:string:1-64' }), (socket, p) => {
    const name = p.name ?? null;
    if (name != null && !ctx.data.get(name)) return ctx.reject(socket, `${name} 还没有运行记录`);
    ctx.data.setClass({ featured: name });
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
