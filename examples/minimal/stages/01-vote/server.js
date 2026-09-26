import { shape } from '#kernel/server/schema.js';

export function register(ctx) {
  // 可改选：每次都是一次 data.set（浅合并），submittedAt 取最近一次
  ctx.on('student:vote', shape({ choice: 'enum:A,B,C,D' }), (socket, payload, actor) => {
    ctx.data.set(actor.name, { choice: payload.choice, submittedAt: Date.now() });
  });
}
