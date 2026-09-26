// vote 投票原语（活动原语规格 §3.1）：一题单选 / 多选，全班分布实时上大屏；可选揭晓正确答案。
// 用法见同目录 README.md。defaults 每项是 (options) => 值 的工厂（契约 v0.8 §五）。
import { shape } from '#kernel/server/schema.js';
import { declarativeGate, validateGateSpec } from '../_shared/gate.js';
import { validatePrompt } from '../_shared/prompt.js';
import { KEYS, formatChoice, isCorrect, topChoices } from './choices.js';

const DEFAULTS = {
  multiple: false,
  anonymous: false,
  canChange: true,
  gate: { submitted: 0.7, soft: true },
  idleAlertMs: 180_000,
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// choices 统一成 [{ key, text }]（字符串数组按 A–H 编键）；answer 统一成按选项顺序的键数组；补齐缺省值
export function normalize(raw) {
  const o = { ...DEFAULTS, ...raw };
  if (!Array.isArray(o.choices)) throw new Error('choices 必须是数组（字符串，或 { key, text }）');
  if (o.choices.length < 2) throw new Error('choices 至少 2 项');
  if (o.choices.length > KEYS.length) throw new Error(`choices 最多 ${KEYS.length} 项`);
  const seen = new Set();
  const choices = o.choices.map((c, i) => {
    let item;
    if (typeof c === 'string') item = { key: KEYS[i], text: c };
    else if (isPlainObject(c)) item = { key: c.key, text: c.text };
    else throw new Error(`choices[${i}] 必须是字符串或 { key, text }`);
    if (typeof item.key !== 'string' || !KEYS.includes(item.key)) throw new Error(`choices[${i}].key 必须是 A–H 之一`);
    if (seen.has(item.key)) throw new Error(`choices[${i}].key "${item.key}" 重复`);
    if (typeof item.text !== 'string' || item.text.trim() === '' || item.text.length > 200) {
      throw new Error(`choices[${i}] 的文字必须是 1–200 字`);
    }
    seen.add(item.key);
    return item;
  });
  const out = { ...o, choices };
  delete out.answer;
  if (o.answer !== undefined && o.answer !== null) {
    const list = Array.isArray(o.answer) ? o.answer : [o.answer];
    if (list.length === 0) throw new Error('answer 不能是空数组（不设答案就不写 answer）');
    for (const k of list) {
      if (!seen.has(k)) throw new Error(`answer "${k}" 不在 choices 的键（${[...seen].join(' / ')}）里`);
    }
    const answer = choices.map((c) => c.key).filter((k) => list.includes(k));
    if (o.multiple !== true && answer.length > 1) throw new Error('单选题的 answer 只能有一个（多个正确项请写 multiple: true）');
    out.answer = answer;
  }
  return out;
}

const baseShape = shape({
  question: 'string:1-500',
  choices: 'array:object',
  multiple: 'boolean',
  answer: 'optional:array:string',
  anonymous: 'boolean',
  canChange: 'boolean',
  idleAlertMs: 'integer:0-86400000',
});

// prompt（P4，可选）：题目之外的正文（短信原文、材料），学生页与大屏在标题下方显示；question 仍进标题区
function validate(o) {
  const { gate, prompt, ...rest } = o;
  validatePrompt(o);
  baseShape(rest);
  if (isPlainObject(gate) && 'correct' in gate && !o.answer) throw new Error('gate.correct 需要先写 answer');
  validateGateSpec(gate, o.answer ? ['submitted', 'correct'] : ['submitted']);
  return o;
}

// correct 按 options.answer 现算：记录里的 correct 要到揭晓时才写
const predicatesOf = (o) => ({
  submitted: (r) => r?.choice != null,
  correct: (r) => r?.choice != null && isCorrect(o, r.choice) === true,
});

function idleText(ms) {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} 分钟未提交` : `${Math.round(ms / 1000)} 秒未提交`;
}

export default {
  type: 'vote',
  label: '投票',
  layout: 'focus',
  // 保密选项：学生收到的 classroom:state 里没有 answer；学生端的正确答案在揭晓时经班级记录（perClass.answer）到达
  secretOptions: ['answer'],
  options: validate,
  normalize,
  defaults: {
    gate: (o) => declarativeGate(o.gate, predicatesOf(o)),

    collect: (o) => ({
      perStudent: {
        choice: o.multiple ? 'array' : 'text',
        submittedAt: 'integer',
        ...(o.answer ? { correct: 'boolean' } : {}),
      },
      ...(o.answer ? { perClass: { answer: 'array', revealedAt: 'integer' } } : {}),
    }),

    subPhases: (o) => (o.answer ? ['answer', 'reveal'] : undefined),

    alerts: (o) => (o.idleAlertMs > 0
      ? [{
        id: 'idle',
        when: (s, now) => s.choice == null && s.enteredStageAt != null && now - s.enteredStageAt > o.idleAlertMs,
        text: idleText(o.idleAlertMs),
      }]
      : []),

    // 已提交者按提交先后前 5（share 组件自行过滤在线）
    recommend: () => ({ perStudent }) => Object.entries(perStudent ?? {})
      .filter(([, r]) => r?.choice != null && typeof r.submittedAt === 'number')
      .sort((a, b) => a[1].submittedAt - b[1].submittedAt)
      .slice(0, 5)
      .map(([name], i) => ({ name, reason: `第 ${i + 1} 个提交` })),

    // 无 answer：提交 1、否则 0；有 answer：答对 1、答错 0.5、未提交 0
    score: (o) => (record) => {
      if (record?.choice == null) return 0;
      if (!o.answer) return 1;
      return (record.correct ?? isCorrect(o, record.choice)) ? 1 : 0.5;
    },

    summarize: (o) => (record, { perStudent } = {}) => {
      const items = [
        { label: '我的选择', value: formatChoice(o, record?.choice) },
        { label: '全班最多的选项', value: topChoices(o, perStudent) },
      ];
      if (o.answer && record?.choice != null) {
        const ok = record.correct ?? isCorrect(o, record.choice);
        items.push({ label: '是否答对', value: ok ? '答对' : '答错' });
      }
      return items;
    },
  },
};
