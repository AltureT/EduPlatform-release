import { shape } from '#kernel/server/schema.js';

export function register(ctx) {
  // 可多次修改；长度上限由 schema 保证。length 与 schema、客户端一致，统一按 UTF-16 .length 计
  ctx.on('student:write', shape({ text: 'string:0-100' }), (socket, payload, actor) => {
    const text = payload.text;
    ctx.data.set(actor.name, { text, length: text.length });
  });
}
