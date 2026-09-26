// 体验 + 建模：自写阶段（primitive: null），写法见契约 §二。
export default {
  id: 'model',
  label: '体验 + 建模',
  primitive: null,
  reviewInteractive: false,
  layout: 'stack',             // 页面样式：有先后顺序的两步

  // E：全部在线学生第二步验证通过；软提示（教师可一键继续）
  gate(ctx) {
    const connected = ctx.state.connected();
    const passed = connected.filter((s) => ctx.data.get(s.name)?.passed === true).length;
    if (passed < connected.length) {
      return { ok: false, soft: true, reason: `验证通过 ${passed}/${connected.length}` };
    }
    return { ok: true };
  },

  // 放权后才加入的学生，也写上放权时间（提醒用）
  onLateJoin(student, ctx) {
    const { released, releasedAt } = ctx.data.getClass();
    if (released && ctx.data.get(student.name)?.releasedAt == null) ctx.data.set(student.name, { releasedAt });
  },

  // C 栏：不进个人报告
  summarize() {
    return [];
  },

  collect: {
    perStudent: {
      step1Features: 'array',
      step1Scores: 'array',
      step1At: 'integer',
      weights: 'object',
      verifyScores: 'array',
      passed: 'boolean',
      verifyCount: 'integer',
      verifiedAt: 'integer',
      releasedAt: 'integer',
    },
    perClass: { released: 'boolean', releasedAt: 'integer' },
  },

  // D：放权后 3 分钟未验证通过
  alerts: [
    {
      id: 'release-idle',
      when: (s, now) => s.releasedAt != null && s.passed !== true && now - s.releasedAt > 180_000,
      text: '放权后 3 分钟未验证通过',
    },
  ],
};
