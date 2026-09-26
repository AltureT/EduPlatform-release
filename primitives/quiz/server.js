// quiz 原语的事件（活动原语规格 §3.2）
//   student:quiz-submit { answers }：键为题目 id，值按题型（single 选项键 / truefalse 布尔 / blank ≤ 100 字）；可只答一部分
//                                    （到时自动提交）；只能提交一次；reveal 模式揭晓后拒绝。写 { answers, submittedAt, elapsedMs }，
//                                    student-after-submit 时同时写 { score, total, results, explanations }——不写正确答案本身；
//                                    reveal / never 提交时不判分（回执发给本人，写了就提前知道对错）
//   teacher:reveal {}：仅 showResultTo 为 'reveal' 时注册；先写班级记录 { answerKey, explanations, revealedAt }，
//                      再给已提交的记录写 { score, total, results }，最后子阶段 answer → reveal（班级记录先于子阶段到达学生端）
import { shape } from '#kernel/server/schema.js';
import { checkAnswers, grade } from './items.js';

export function register(ctx, options) {
  const mode = options.showResultTo;
  const revealed = () => ctx.state.subPhase === 'reveal' || ctx.data.getClass().revealedAt != null;
  const hasExplain = Object.keys(options.explanations ?? {}).length > 0;

  ctx.on('student:quiz-submit', shape({ answers: 'object' }), (socket, payload, actor) => {
    if (mode === 'reveal' && revealed()) return ctx.reject(socket, '已揭晓，不能再提交');
    if (ctx.data.get(actor.name)?.submittedAt != null) return ctx.reject(socket, '已提交，不能修改');
    const checked = checkAnswers(options, payload.answers);
    if (checked.error) return ctx.reject(socket, checked.error);
    const now = Date.now();
    const entered = ctx.state.student(actor.name)?.enteredStageAt;
    const record = { answers: checked.answers, submittedAt: now };
    if (typeof entered === 'number') record.elapsedMs = Math.max(0, now - entered);
    if (mode === 'student-after-submit') {
      const { score, total, results } = grade(options, checked.answers);
      Object.assign(record, { score, total, results });
      if (hasExplain) record.explanations = options.explanations;
    }
    ctx.data.set(actor.name, record);
  });

  if (mode === 'reveal') {
    ctx.on('teacher:reveal', shape({}), () => {
      if (ctx.state.subPhase === 'reveal') return;
      ctx.data.setClass({ answerKey: options.answerKey, explanations: options.explanations ?? {}, revealedAt: Date.now() });
      for (const [name, r] of Object.entries(ctx.data.all())) {
        if (r?.submittedAt == null) continue;
        const { score, total, results } = grade(options, r.answers);
        ctx.data.set(name, { score, total, results });
      }
      ctx.setSubPhase('reveal');
    });
  }
}
