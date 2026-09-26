export const MAX_LENGTH = 100;

const lengths = (perStudent) =>
  Object.values(perStudent ?? {}).map((r) => r?.length).filter((n) => typeof n === 'number' && Number.isFinite(n));

function median(values) {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export default {
  id: 'freeform',
  label: '自由作答',
  primitive: null,
  reviewInteractive: false,
  layout: 'focus',             // 页面样式（契约 v0.7）：focus | split | tiles | table | stack

  // E：无门槛（缺省 gate 由内核视为通过；这里显式写出，便于测试与阅读）
  gate() {
    return { ok: true };
  },

  // 组件钩子（契约 §二 v0.5）：个人报告条目——本人字数，附全班中位数
  summarize(record, { perStudent } = {}) {
    return [{ label: '字数', value: record.length, cohort: { median: median(lengths(perStudent)) } }];
  },

  collect: {
    perStudent: { text: 'text', length: 'integer' },
  },
};
