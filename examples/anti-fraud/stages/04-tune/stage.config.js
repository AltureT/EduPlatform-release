// 开放调参：自写阶段（primitive: null），写法见契约 §二。
function median(values) {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export default {
  id: 'tune',
  label: '开放调参',
  primitive: null,
  reviewInteractive: false,
  layout: 'split',             // 页面样式：左调参、右看结果

  // E：全部在线学生至少检验过一次；硬拦截（不带 soft）
  gate(ctx) {
    const connected = ctx.state.connected();
    const done = connected.filter((s) => (ctx.data.get(s.name)?.tests ?? 0) >= 1).length;
    if (done < connected.length) return { ok: false, reason: `已检验 ${done}/${connected.length}` };
    return { ok: true };
  },

  // 推荐分享：两类——成绩最好（最好 F1 前 3）与实验最认真（填预测次数最多前 2）
  recommend({ perStudent }) {
    const rows = Object.entries(perStudent ?? {}).filter(([, r]) => (r?.tests ?? 0) >= 1);
    const best = [...rows].sort((a, b) => (b[1].bestF1 ?? 0) - (a[1].bestF1 ?? 0)).slice(0, 3);
    const picked = new Set(best.map(([n]) => n));
    const careful = rows
      .filter(([n, r]) => !picked.has(n) && (r.predicted ?? 0) > 0)
      .sort((a, b) => (b[1].predicted ?? 0) - (a[1].predicted ?? 0))
      .slice(0, 2);
    return [
      ...best.map(([name, r]) => ({ name, reason: `最好 F1 ${r.bestF1}` })),
      ...careful.map(([name, r]) => ({ name, reason: `填了 ${r.predicted} 次预测` })),
    ];
  },

  // 互助：成绩越好分越高
  score(record) {
    return typeof record?.bestF1 === 'number' ? record.bestF1 : null;
  },

  // 个人报告：检验次数、最好 F1（附全班中位数）、累计猜中
  summarize(record, { perStudent } = {}) {
    const f1s = Object.values(perStudent ?? {}).map((r) => r?.bestF1).filter((x) => typeof x === 'number');
    return [
      { label: '检验次数', value: record.tests ?? 0 },
      { label: '最好 F1', value: record.bestF1 ?? 0, cohort: { median: median(f1s) } },
      { label: '累计猜中', value: record.hitsTotal ?? 0 },
    ];
  },

  collect: {
    perStudent: {
      tests: 'integer',
      last: 'object',
      history: 'array',
      bestF1: 'number',
      predicted: 'integer',
      hitsTotal: 'integer',
      failStreak: 'integer',
      failReason: 'text',
      testedAt: 'integer',
    },
    perClass: {},
  },

  // D：5 分钟还没检验过；连续 2 次没成功
  alerts: [
    {
      id: 'idle',
      when: (s, now) => (s.tests ?? 0) === 0 && s.enteredStageAt != null && now - s.enteredStageAt > 300_000,
      text: '5 分钟未检验',
    },
    { id: 'fail-streak', when: (s) => (s.failStreak ?? 0) >= 2, text: '连续 2 次没成功' },
  ],
};
