// free-text 自由作答原语（活动原语规格 §3.3）：一到三道开放题，短文作答；教师挑一份作答投到大屏（署名）。
// 用法见同目录 README.md。defaults 每项是 (options) => 值 的工厂（契约 v0.8 §五）。
// 页面样式固定 focus（多题时在 focus 面板里纵向排列）：primitive.config 的 layout 是静态值，不能按题数变（见 README）。
import { shape } from '#kernel/server/schema.js';
import { declarativeGate, validateGateSpec } from '../_shared/gate.js';
import { validatePrompt } from '../_shared/prompt.js';
import { ID_RE, MAX_LIMIT, countChars } from './prompts.js';

const DEFAULTS = {
  canChange: true,
  gate: { submitted: 0.7, soft: true },
  idleAlertMs: 180_000,
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (s, max) => typeof s === 'string' && s.trim() !== '' && s.length <= max;

function normalizePrompt(raw, i, ids) {
  const where = `prompts[${i}]`;
  const obj = typeof raw === 'string' ? { title: raw } : raw;
  if (!isPlainObject(obj)) throw new Error(`${where} 必须是字符串或 { id, title, placeholder?, min?, max? }`);
  const { id = `p${i + 1}`, title, placeholder, min = 0, max = 300, ...extra } = obj;
  const unknown = Object.keys(extra);
  if (unknown.length > 0) throw new Error(`${where} 不认识的键 ${unknown.join('、')}（可用：id、title、placeholder、min、max）`);
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`${where}.id 只能用字母、数字、- 和 _（1–32 位）`);
  if (ids.has(id)) throw new Error(`${where}.id "${id}" 重复`);
  ids.add(id);
  if (!nonEmpty(title, 200)) throw new Error(`${where}.title 必须是 1–200 字`);
  if (placeholder !== undefined && !nonEmpty(placeholder, 200)) throw new Error(`${where}.placeholder 必须是 1–200 字`);
  if (!Number.isInteger(max) || max < 1 || max > MAX_LIMIT) throw new Error(`${where}.max 必须是 1–${MAX_LIMIT} 的整数`);
  if (!Number.isInteger(min) || min < 0 || min > max) throw new Error(`${where}.min 必须是 0 到 max（${max}）之间的整数`);
  return { id, title, ...(placeholder !== undefined ? { placeholder } : {}), min, max };
}

// prompts 统一成 [{ id, title, placeholder?, min, max }]（字符串写法按 p1、p2… 编号）；补齐缺省值
export function normalize(raw) {
  const o = { ...DEFAULTS, ...raw };
  if (!Array.isArray(o.prompts)) throw new Error('prompts 必须是题目数组（字符串，或 { id, title, placeholder?, min?, max? }）');
  if (o.prompts.length < 1) throw new Error('prompts 至少 1 题');
  if (o.prompts.length > 3) throw new Error('prompts 最多 3 题');
  const ids = new Set();
  return { ...o, prompts: o.prompts.map((p, i) => normalizePrompt(p, i, ids)) };
}

const baseShape = shape({
  prompts: 'array:object',
  canChange: 'boolean',
  idleAlertMs: 'integer:0-86400000',
});

// prompt（P4，可选）：各题共用的正文 / 材料（与 prompts 各题的 title 不同），学生页与大屏（未投屏时）在标题下方显示
function validate(o) {
  const { gate, prompt, ...rest } = o;
  validatePrompt(o);
  baseShape(rest);
  validateGateSpec(gate, ['submitted']);
  return o;
}

function idleText(ms) {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} 分钟未提交` : `${Math.round(ms / 1000)} 秒未提交`;
}

const submitted = (r) => r?.submittedAt != null;

export default {
  type: 'free-text',
  label: '自由作答',
  layout: 'focus',
  options: validate,
  normalize,
  defaults: {
    gate: (o) => declarativeGate(o.gate, { submitted }),

    collect: () => ({
      perStudent: { answers: 'object', submittedAt: 'integer' },
      perClass: { featured: 'object' }, // { name, answers, at } 投屏快照，或 null
    }),

    alerts: (o) => (o.idleAlertMs > 0
      ? [{
        id: 'idle',
        when: (s, now) => s.submittedAt == null && s.enteredStageAt != null && now - s.enteredStageAt > o.idleAlertMs,
        text: idleText(o.idleAlertMs),
      }]
      : []),

    // 已提交者按提交先后前 5（share 组件自行过滤在线）
    recommend: () => ({ perStudent }) => Object.entries(perStudent ?? {})
      .filter(([, r]) => submitted(r) && typeof r.submittedAt === 'number')
      .sort((a, b) => a[1].submittedAt - b[1].submittedAt)
      .slice(0, 5)
      .map(([name], i) => ({ name, reason: `第 ${i + 1} 个提交` })),

    // 各题字数之和 ≥ 各题 min 之和（且写了字）为 1，否则 0
    score: (o) => (record) => {
      if (!submitted(record)) return 0;
      const n = o.prompts.reduce((s, p) => s + countChars(record.answers?.[p.id]), 0);
      const need = o.prompts.reduce((s, p) => s + p.min, 0);
      return n > 0 && n >= need ? 1 : 0;
    },

    summarize: (o) => (record) => o.prompts.map((p) => {
      const t = typeof record?.answers?.[p.id] === 'string' ? record.answers[p.id].trim() : '';
      return { label: p.title, value: t || '（未作答）' };
    }),
  },
};
