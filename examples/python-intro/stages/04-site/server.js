import { recordShapeWith } from '#components/sandbox/record-shape.js';

// §3.6 记录 + homeStatus（首页响应状态码，拿不到时为 null）
const siteShape = recordShapeWith({ homeStatus: 'optional:integer:100-599' });

export function register(ctx) {
  // 提交：可重复提交，以最后一次为准
  ctx.on('student:submit', siteShape, (socket, p, actor) => {
    ctx.data.set(actor.name, { ...p, homeStatus: p.homeStatus ?? null, submittedAt: Date.now() });
  });
}
