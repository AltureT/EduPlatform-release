// vote 原语的事件（活动原语规格 §3.1）
//   student:vote { choice }：单选为键，多选为键数组（去重、按选项顺序、1–8 项）；canChange=false 时已提交不能再改；
//                            揭晓后拒绝；写 { choice, submittedAt }——不写 correct（回执会发给本人，写了就能逐项试出答案）
//   teacher:reveal {}：仅有 answer 时注册；先写班级记录 { answer, revealedAt }（学生端从这里拿正确答案，回看与镜像也靠它），
//                      再给已提交的记录写 correct，最后子阶段 answer → reveal（班级记录先于子阶段到达学生端）
import { shape } from '#kernel/server/schema.js';
import { KEYS, isCorrect, orderKeys } from './choices.js';

export function register(ctx, options) {
  const keys = options.choices.map((c) => c.key);
  const schema = options.multiple ? shape({ choice: 'array:string' }) : shape({ choice: `enum:${keys.join(',')}` });

  ctx.on('student:vote', schema, (socket, payload, actor) => {
    if (ctx.state.subPhase === 'reveal' || ctx.data.getClass().revealedAt != null) return ctx.reject(socket, '已揭晓，不能再提交');
    const prev = ctx.data.get(actor.name);
    if (options.canChange === false && prev?.choice != null) return ctx.reject(socket, '已提交，不能修改');
    let choice = payload.choice;
    if (options.multiple) {
      if (choice.length > KEYS.length) return ctx.reject(socket, `最多 ${KEYS.length} 项`);
      const unknown = choice.find((k) => !keys.includes(k));
      if (unknown !== undefined) return ctx.reject(socket, `没有选项 ${unknown}`);
      choice = orderKeys(options, choice);
      if (choice.length === 0) return ctx.reject(socket, '至少选一项');
    }
    ctx.data.set(actor.name, { choice, submittedAt: Date.now() });
  });

  if (options.answer) {
    ctx.on('teacher:reveal', shape({}), () => {
      if (ctx.state.subPhase === 'reveal') return;
      ctx.data.setClass({ answer: options.answer, revealedAt: Date.now() });
      for (const [name, r] of Object.entries(ctx.data.all())) {
        if (r?.choice != null) ctx.data.set(name, { correct: isCorrect(options, r.choice) });
      }
      ctx.setSubPhase('reveal');
    });
  }
}
