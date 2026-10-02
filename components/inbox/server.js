// inbox 随堂一句话（规格 §3.3）：教师任一阶段开一道开放题，学生作答，只有教师能关
// perClass = { open, question: { id, title, fields } | null, openedAt }
// perStudent[name] = { [questionId]: { answers, at } }
import { shape } from '#kernel/server/schema.js';

const ADHOC_FIELDS = [{ key: 'text', label: '', max: 200 }];

const copyQuestion = (q) => ({
  id: q.id,
  title: q.title,
  fields: q.fields.map((f) => ({ key: f.key, label: f.label, max: f.max })),
});

export function register(cctx) {
  const questions = Array.isArray(cctx.options?.questions) ? cctx.options.questions : [];

  cctx.on(
    'inbox:t-open',
    shape({ questionId: 'optional:string', title: 'optional:string' }),
    (socket, payload) => {
      const hasId = payload.questionId !== undefined;
      const hasTitle = payload.title !== undefined;
      if (hasId === hasTitle) return cctx.reject(socket, '需要 questionId 或 title 之一');

      let question;
      if (hasId) {
        const q = questions.find((x) => x.id === payload.questionId);
        if (!q) return cctx.reject(socket, '题目不存在');
        question = copyQuestion(q);
      } else {
        const title = payload.title.trim();
        if (!title) return cctx.reject(socket, '标题为空');
        question = { id: `adhoc-${Date.now()}`, title, fields: ADHOC_FIELDS.map((f) => ({ ...f })) };
      }
      cctx.data.setClass({ open: true, question, openedAt: Date.now() });
    },
  );

  cctx.on('inbox:t-close', shape({}), () => {
    cctx.data.setClass({ open: false });
  });

  cctx.on(
    'inbox:s-submit',
    shape({ questionId: 'string', answers: 'object' }),
    (socket, payload, actor) => {
      const cls = cctx.data.getClass() ?? {};
      if (!cls.open || !cls.question) return cctx.reject(socket, '随堂一句话未开启');
      const { question } = cls;
      if (payload.questionId !== question.id) return cctx.reject(socket, '题目已变更');

      const byKey = new Map(question.fields.map((f) => [f.key, f]));
      for (const [key, value] of Object.entries(payload.answers)) {
        const field = byKey.get(key);
        if (!field) return cctx.reject(socket, '未知字段');
        if (typeof value !== 'string') return cctx.reject(socket, '字段须为文本');
        if (value.length > field.max) return cctx.reject(socket, '超出字数');
      }
      const answers = {};
      for (const f of question.fields) answers[f.key] = payload.answers[f.key] ?? '';
      if (Object.values(answers).every((v) => v.trim() === '')) return cctx.reject(socket, '内容为空');

      cctx.data.set(actor.name, { [question.id]: { answers, at: Date.now() } });
    },
  );
}
