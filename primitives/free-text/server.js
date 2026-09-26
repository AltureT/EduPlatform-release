// free-text 原语的事件（活动原语规格 §3.3）
//   student:freetext-submit { answers }：键为题目 id、值为字符串；去首尾空白后按字符计数，超过 max 拒绝并给出字数，
//                                        不到 min 拒绝，全部为空拒绝；canChange=false 时已提交不能再改。写 { answers, submittedAt }
//   teacher:feature { name | null }：把一位已提交学生的作答投到大屏——班级记录 featured = { name, answers, at }，answers 为
//                                   投屏时刻各题原文的快照（该生之后"更新"不会改动大屏；再投一次取最新）；null 取消展示
import { shape } from '#kernel/server/schema.js';
import { checkLengths } from './prompts.js';

export function register(ctx, options) {
  const ids = new Set(options.prompts.map((p) => p.id));

  ctx.on('student:freetext-submit', shape({ answers: 'object' }), (socket, payload, actor) => {
    const prev = ctx.data.get(actor.name);
    if (options.canChange === false && prev?.submittedAt != null) return ctx.reject(socket, '已提交，不能修改');
    for (const [k, v] of Object.entries(payload.answers)) {
      if (!ids.has(k)) return ctx.reject(socket, `没有题目 ${k}`);
      if (typeof v !== 'string') return ctx.reject(socket, `题目 ${k} 的作答必须是文字`);
    }
    const checked = checkLengths(options, payload.answers);
    if (checked.error) return ctx.reject(socket, checked.error);
    ctx.data.set(actor.name, { answers: checked.answers, submittedAt: Date.now() });
  });

  ctx.on('teacher:feature', shape({ name: 'optional:string:1-64' }), (socket, payload) => {
    const name = payload.name ?? null;
    if (name == null) return ctx.data.setClass({ featured: null });
    const record = ctx.data.get(name);
    if (record?.submittedAt == null) return ctx.reject(socket, `${name} 还没有提交`);
    ctx.data.setClass({ featured: { name, answers: { ...record.answers }, at: Date.now() } });
  });
}
