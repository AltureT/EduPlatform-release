import { recordShape } from '#components/sandbox/record-shape.js';

export function register(ctx) {
  // 提交：记录含至多 1 张图（buildRecord 取 imagesCompact[0]）；可重复提交，以最后一次为准
  ctx.on('student:submit', recordShape, (socket, p, actor) => {
    ctx.data.set(actor.name, { ...p, submittedAt: Date.now() });
  });
}
