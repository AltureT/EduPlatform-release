// 题目与选项写死在这里；onEnter 时写入班级记录，学生与教师视图从 classData / perClass 读取
export const QUESTION = '下列哪个数是质数？';
export const OPTIONS = [
  { key: 'A', text: '21' },
  { key: 'B', text: '27' },
  { key: 'C', text: '29' },
  { key: 'D', text: '33' },
];

const optionText = (key) => {
  const o = OPTIONS.find((x) => x.key === key);
  return o ? `${o.key}（${o.text}）` : '未作答';
};

function topChoices(perStudent) {
  const counts = new Map(OPTIONS.map((o) => [o.key, 0]));
  for (const r of Object.values(perStudent ?? {})) {
    if (counts.has(r?.choice)) counts.set(r.choice, counts.get(r.choice) + 1);
  }
  const max = Math.max(...counts.values());
  if (max === 0) return '—';
  return OPTIONS.filter((o) => counts.get(o.key) === max).map((o) => optionText(o.key)).join('、');
}

export default {
  id: 'vote',
  label: '投票',
  primitive: null,
  reviewInteractive: false,
  layout: 'focus',             // 页面样式（契约 v0.7）：focus | split | tiles | table | stack

  // E：在线学生提交率 ≥ 70%，软提示
  gate(ctx) {
    const connected = ctx.state.connected();
    const submitted = connected.filter((s) => ctx.data.get(s.name)?.choice != null).length;
    if (submitted < Math.ceil(connected.length * 0.7)) {
      return { ok: false, soft: true, reason: `已提交 ${submitted}/${connected.length}，未到 70%` };
    }
    return { ok: true };
  },

  async onEnter(ctx) {
    ctx.data.setClass({ question: QUESTION, options: OPTIONS });
  },

  collect: {
    perStudent: { choice: 'text', submittedAt: 'integer' },
    perClass: { question: 'text', options: 'array' },
  },

  // 组件钩子（契约 §二 v0.5）：由 share / report 调用，内核不调用
  // recommend：已提交者按 submittedAt 升序前 5，reason 为"第 N 个提交"；roster 含离线学生，由 share 组件过滤在线
  recommend({ perStudent }) {
    return Object.entries(perStudent ?? {})
      .filter(([, r]) => r?.choice != null && typeof r.submittedAt === 'number')
      .sort((a, b) => a[1].submittedAt - b[1].submittedAt)
      .slice(0, 5)
      .map(([name], i) => ({ name, reason: `第 ${i + 1} 个提交` }));
  },

  // score：提交为 1，否则 0（share 自动选被帮助者时取最低三分之一）
  score(record) {
    return record?.choice != null ? 1 : 0;
  },

  // summarize：个人报告条目——我的选择、全班最多的选项（并列时全部列出）
  summarize(record, { perStudent } = {}) {
    return [
      { label: '我的选择', value: optionText(record?.choice) },
      { label: '全班最多的选项', value: topChoices(perStudent) },
    ];
  },

  alerts: [
    { id: 'idle', when: (s, now) => s.choice == null && s.enteredStageAt != null && now - s.enteredStageAt > 180_000, text: '3 分钟未提交' },
  ],
};
