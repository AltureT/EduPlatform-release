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
//   P7（教师现场演示规格 §3、§5）：teacher:push-code { code | null }：code 为字符串（≤ 20000 字）→ perClass.pushedCode = { code, at }；
//                        null / 缺省 → pushedCode = null（撤回）。defaults.onLeave 与 classroom:reset（内核清阶段数据）清掉它。
//                        两个学生事件可带 fromTeacher（布尔）：true 时写进记录顶层（历史标记，合并写入，之后不带也不清）；
//                        多份起始代码时 starterLabel 另认 PUSHED_LABEL"老师下发"（学生在选择页选了老师刚发的代码）
//   V2（代码题批改规格 §4.3）：有 options.mistakes 时，两个学生事件的载荷带 tests.cases 就按失败集合匹配错误类型，
//                        写 mistake: { id, label } | null（code-final 写 final.mistake）；tests 为 null（改了代码没再测）时记录顶层的 mistake 保留上一次；
//                        没有 mistakes 选项时不写该字段
//   K10（_shared/finalLite.js）：上交最终稿之后的 student:code-submit 推送（教师 data-update、本人 my-data）里 final 只带摘要
//                        { at, stale?, afterSolution?, mistake?, lite: true }，存储仍完整；被投屏的学生照推完整；teacher:feature 投某生时补推一次完整记录
import { shape } from '#kernel/server/schema.js';
import { recordShapeWith } from '#components/sandbox/record-shape.js';
import { allPassed, finalPatch } from './record.js';
import { matchMistake } from './mistakes.js';
import { PUSHED_LABEL, pushCodeShape, pushedPatch } from '../_shared/pushCode.js';
import { pushLite } from '../_shared/finalLite.js';

const withLabel = { starterLabel: 'optional:string:1-12', fromTeacher: 'optional:boolean' };
const submitShape = recordShapeWith(withLabel);
const finalShape = recordShapeWith({ stale: 'optional:boolean', ...withLabel });

export function register(ctx, options) {
  const withSolution = !!options?.solution;
  const labels = new Set(Array.isArray(options?.starters) ? options.starters.map((s) => s.label) : []);
  if (labels.size > 0) labels.add(PUSHED_LABEL);
  // 载荷里的 starterLabel：认识的留下，其余去掉；fromTeacher 只在为 true 时写
  const labelOf = (p) => {
    const { starterLabel, fromTeacher, ...rest } = p;
    const label = typeof starterLabel === 'string' && labels.has(starterLabel) ? { starterLabel } : {};
    if (fromTeacher === true) label.fromTeacher = true;
    return { rest, label };
  };
  // V2：错误库匹配（只在载荷带 tests.cases 时算；返回 undefined 表示不写）
  const mistakes = options?.mistakes ?? null;
  const mistakeFor = (p) => (mistakes && Array.isArray(p?.tests?.cases) ? matchMistake(p.tests.cases, mistakes) : undefined);
  // 参考答案是否正在公布（班级记录里有 solutionPublishedAt）
  const published = () => ctx.data.getClass()?.solutionPublishedAt != null;

  ctx.on('student:code-submit', submitShape, (socket, payload, actor) => {
    const { rest: p, label } = labelOf(payload);
    const now = Date.now();
    const first = allPassed(p.tests) && ctx.data.get(actor.name)?.firstPassedAt == null ? { firstPassedAt: now } : {};
    const mark = withSolution && published() ? { afterSolution: true } : {};
    const mistake = mistakeFor(p);
    ctx.data.set(actor.name, { ...p, submittedAt: now, ...first, ...mark, ...label, ...(mistake !== undefined ? { mistake } : {}) }, {
      push: pushLite(() => ctx.data.getClass()?.featured === actor.name),
    });
  });

  ctx.on('student:code-final', finalShape, (socket, payload, actor) => {
    const { rest: p, label } = labelOf(payload);
    const patch = finalPatch(p, Date.now());
    if (withSolution && published()) patch.final.afterSolution = true;
    const mistake = mistakeFor(p);
    if (mistake !== undefined) patch.final.mistake = mistake;
    ctx.data.set(actor.name, { ...patch, ...label });
  });

  ctx.on('teacher:feature', shape({ name: 'optional:string:1-64' }), (socket, p) => {
    const name = p.name ?? null;
    if (name != null && !ctx.data.get(name)) return ctx.reject(socket, `${name} 还没有运行记录`);
    ctx.data.setClass({ featured: name });
    // K10：教师端这位学生的 final 可能是摘要，补推一次完整记录给大屏
    if (name != null) ctx.data.set(name, {});
  });

  ctx.on('teacher:push-code', pushCodeShape, (socket, p) => {
    ctx.data.setClass(pushedPatch(p, Date.now()));
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
