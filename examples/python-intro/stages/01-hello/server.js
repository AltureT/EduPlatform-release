import { recordShape, draftShape } from '#components/sandbox/record-shape.js';

export function register(ctx) {
  // 提交：可重复提交，以最后一次为准
  ctx.on('student:submit', recordShape, (socket, p, actor) => {
    ctx.data.set(actor.name, { ...p, submittedAt: Date.now() });
  });

  // 草稿（PyRunner draftEvent）：只写 draft 子记录，不写 submittedAt、不覆盖提交字段（规格 §3.6）
  ctx.on('student:draft', draftShape, (socket, p, actor) => {
    ctx.data.set(actor.name, { draft: { ...p, at: Date.now() } });
  });
}
