// 集体拦截：自写阶段（primitive: null），写法见契约 §二。
import { TYPES } from './data.js';

function median(values) {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const pct = (x) => `${Math.round(x * 100)}%`;

export default {
  id: 'intercept',
  label: '集体拦截',
  primitive: null,
  reviewInteractive: false,
  layout: 'focus',             // 页面样式：学生只看自己的一份结果
  components: ['share', 'report'],   // 本段显示入口的组件（平台规格"触发的组件"）：挑人分享、邀请互助、推荐分享、个人报告

  // E：无门槛（跑完教师就进）
  gate() {
    return { ok: true };
  },

  // 推荐分享：F1 前 3；误拦最少且查全 ≥ 70% 的前 2
  recommend({ perStudent }) {
    const rows = Object.entries(perStudent ?? {}).filter(([, r]) => typeof r?.f1 === 'number');
    const top = [...rows].sort((a, b) => b[1].f1 - a[1].f1).slice(0, 3);
    const picked = new Set(top.map(([n]) => n));
    const careful = rows
      .filter(([n, r]) => !picked.has(n) && r.recall >= 0.7)
      .sort((a, b) => a[1].blocked - b[1].blocked)
      .slice(0, 2);
    return [
      ...top.map(([name, r]) => ({ name, reason: `F1 ${r.f1}` })),
      ...careful.map(([name, r]) => ({ name, reason: `误拦 ${r.blocked} 条` })),
    ];
  },

  score(record) {
    return typeof record?.f1 === 'number' ? record.f1 : null;
  },

  // 个人报告：统一测试 F1（附全班中位数）、查全、查准、误拦数、四类各抓到几条
  summarize(record, { perStudent } = {}) {
    const f1s = Object.values(perStudent ?? {}).map((r) => r?.f1).filter((x) => typeof x === 'number');
    return [
      { label: '统一测试 F1', value: record.f1, cohort: { median: median(f1s) } },
      { label: '查全', value: pct(record.recall) },
      { label: '查准', value: pct(record.precision) },
      { label: '误拦数', value: record.blocked },
      ...TYPES.map((t) => {
        const b = record.byType?.[t.key] ?? { caught: 0, total: 0 };
        return { label: `${t.label} 抓到`, value: `${b.caught}/${b.total}` };
      }),
    ];
  },

  collect: {
    perStudent: {
      recall: 'number',
      precision: 'number',
      f1: 'number',
      blocked: 'integer',
      byType: 'object',
      blockedIds: 'array',
      ranAt: 'integer',
    },
    perClass: {},
  },

  // D：不用提醒
  alerts: [],
};
