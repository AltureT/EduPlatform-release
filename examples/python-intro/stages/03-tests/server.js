import { recordShape } from '#components/sandbox/record-shape.js';
import { allPassed } from './stage.config.js';

export function register(ctx) {
  // 提交：只收全部通过的记录（客户端按钮同样按此启用，这里复核）；可重复提交，以最后一次为准
  ctx.on('student:submit', recordShape, (socket, p, actor) => {
    if (!allPassed(p.tests)) return ctx.reject(socket, '测试未全部通过');
    ctx.data.set(actor.name, { ...p, submittedAt: Date.now() });
  });
}
