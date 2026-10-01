// quiz 小测验原语（活动原语规格 §3.2）：多题（单选 / 判断 / 填空精确匹配）顺序作答，自动判分。
// 用法见同目录 README.md。defaults 每项是 (options) => 值 的工厂（契约 v0.8 §五）。
//
// 保密选项（规格 §2.8）：stage.config 里写在每题上的 answer / explain，由 normalize 移到顶层的 answerKey / explanations，
// 二者声明为 secretOptions——kernel 按顶层键剥离，学生收到的 classroom:state 里只有题面（items）。
// 答案与解析到达学生的途径：student-after-submit 提交时本人记录写得分 / 逐题对错 / 解析（不写答案本身）；
// reveal 揭晓时班级记录写 answerKey / explanations、已提交者记录写得分与逐题对错；never 都不写。
import { shape } from '#kernel/server/schema.js';
import { averageOf, declarativeGate, validateGateSpec } from '../_shared/gate.js';
import { validatePrompt } from '../_shared/prompt.js';
import { BLANK_MAX, ID_RE, KEYS, TYPES, formatNumbers, median, scoreOf, wrongNumbers, isAnswered } from './items.js';

export const MODES = ['student-after-submit', 'reveal', 'never'];

const DEFAULTS = {
  shuffle: false,
  showResultTo: 'student-after-submit',
  gate: { submitted: 0.7, soft: true },
  idleAlertMs: 180_000,
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (s, max) => typeof s === 'string' && s.trim() !== '' && s.length <= max;

function normalizeChoices(raw, where) {
  if (!Array.isArray(raw)) throw new Error(`${where}.choices 必须是数组（字符串，或 { key, text }）`);
  if (raw.length < 2) throw new Error(`${where}.choices 至少 2 项`);
  if (raw.length > KEYS.length) throw new Error(`${where}.choices 最多 ${KEYS.length} 项`);
  const seen = new Set();
  return raw.map((c, i) => {
    let item;
    if (typeof c === 'string') item = { key: KEYS[i], text: c };
    else if (isPlainObject(c)) item = { key: c.key, text: c.text };
    else throw new Error(`${where}.choices[${i}] 必须是字符串或 { key, text }`);
    if (typeof item.key !== 'string' || !KEYS.includes(item.key)) throw new Error(`${where}.choices[${i}].key 必须是 A–H 之一`);
    if (seen.has(item.key)) throw new Error(`${where}.choices[${i}].key "${item.key}" 重复`);
    if (!nonEmpty(item.text, 200)) throw new Error(`${where}.choices[${i}] 的文字必须是 1–200 字`);
    seen.add(item.key);
    return item;
  });
}

function normalizeItem(raw, i, ids) {
  const where = `items[${i}]`;
  if (!isPlainObject(raw)) throw new Error(`${where} 必须是 { id, type, question, answer } 对象`);
  const { id = `q${i + 1}`, type, question, choices, answer, explain, ...extra } = raw;
  const unknown = Object.keys(extra);
  if (unknown.length > 0) throw new Error(`${where} 不认识的键 ${unknown.join('、')}（可用：id、type、question、choices、answer、explain）`);
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`${where}.id 只能用字母、数字、- 和 _（1–32 位）`);
  if (ids.has(id)) throw new Error(`${where}.id "${id}" 重复`);
  ids.add(id);
  if (!TYPES.includes(type)) throw new Error(`${where}.type 必须是 ${TYPES.join(' / ')} 之一`);
  if (!nonEmpty(question, 500)) throw new Error(`${where}.question 必须是 1–500 字`);
  if (explain !== undefined && !nonEmpty(explain, 1000)) throw new Error(`${where}.explain 必须是 1–1000 字（不写解析就不写 explain）`);
  const item = { id, type, question };
  let key;
  if (type === 'single') {
    item.choices = normalizeChoices(choices, where);
    const keys = item.choices.map((c) => c.key);
    if (typeof answer !== 'string') throw new Error(`${where}.answer 必须是一个选项键（${keys.join(' / ')}）`);
    if (!keys.includes(answer)) throw new Error(`${where}.answer "${answer}" 不在 choices 的键（${keys.join(' / ')}）里`);
    key = answer;
  } else {
    if (choices !== undefined) throw new Error(`${where}：${type} 题不写 choices`);
    if (type === 'truefalse') {
      if (typeof answer !== 'boolean') throw new Error(`${where}.answer 必须是 true / false`);
      key = answer;
    } else {
      const list = Array.isArray(answer) ? answer : [answer];
      if (list.length === 0 || !list.every((a) => nonEmpty(a, BLANK_MAX))) {
        throw new Error(`${where}.answer 必须是 1–${BLANK_MAX} 字的字符串，或这样的字符串数组（多个可接受答案）`);
      }
      key = list.map((a) => a.trim());
    }
  }
  return { item, key, explain };
}

// 每题的 answer / explain 移到顶层 answerKey / explanations（保密选项）；choices 统一成 [{ key, text }]；补齐缺省值
export function normalize(raw) {
  const o = { ...DEFAULTS, ...raw };
  if (!Array.isArray(o.items)) throw new Error('items 必须是题目数组');
  if (o.items.length < 1) throw new Error('items 至少 1 题');
  if (o.items.length > 30) throw new Error('items 最多 30 题');
  const ids = new Set();
  const items = [];
  const answerKey = {};
  const explanations = {};
  o.items.forEach((raw1, i) => {
    const { item, key, explain } = normalizeItem(raw1, i, ids);
    items.push(item);
    answerKey[item.id] = key;
    if (explain !== undefined) explanations[item.id] = explain;
  });
  return { ...o, items, answerKey, explanations };
}

const baseShape = shape({
  items: 'array:object',
  answerKey: 'object',
  explanations: 'object',
  shuffle: 'boolean',
  showResultTo: `enum:${MODES.join(',')}`,
  timeLimitSec: 'optional:integer:10-7200',
  idleAlertMs: 'integer:0-86400000',
});

// prompt（P4，可选）：全卷共用的正文 / 材料，学生页（每一题与结果页）与大屏在标题下方显示
function validate(o) {
  const { gate, prompt, ...rest } = o;
  validatePrompt(o);
  baseShape(rest);
  validateGateSpec(gate, ['submitted', 'correct']);
  return o;
}

// gate.correct = 在线学生的平均得分率（未提交算 0，离线不计）：_shared/gate.js 的平均比率写法（K10）
const scoreRate = (o) => averageOf((r) => {
  const g = scoreOf(o, r);
  return g && g.total > 0 ? g.score / g.total : 0;
}, '平均得分率');

function idleText(ms) {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} 分钟未提交` : `${Math.round(ms / 1000)} 秒未提交`;
}

const submitted = (r) => r?.submittedAt != null;

export default {
  type: 'quiz',
  label: '小测验',
  layout: 'focus',
  secretOptions: ['answerKey', 'explanations'],
  options: validate,
  normalize,
  defaults: {
    gate: (o) => declarativeGate(o.gate, { submitted, correct: scoreRate(o) }),

    collect: (o) => ({
      perStudent: {
        answers: 'object',
        submittedAt: 'integer',
        elapsedMs: 'integer',
        ...(o.showResultTo !== 'never' ? { score: 'integer', total: 'integer', results: 'object' } : {}),
        ...(o.showResultTo === 'student-after-submit' ? { explanations: 'object' } : {}),
      },
      ...(o.showResultTo === 'reveal' ? { perClass: { answerKey: 'object', explanations: 'object', revealedAt: 'integer' } } : {}),
    }),

    subPhases: (o) => (o.showResultTo === 'reveal' ? ['answer', 'reveal'] : undefined),

    alerts: (o) => (o.idleAlertMs > 0
      ? [{
        id: 'idle',
        when: (s, now) => s.submittedAt == null && s.enteredStageAt != null && now - s.enteredStageAt > o.idleAlertMs,
        text: idleText(o.idleAlertMs),
      }]
      : []),

    // 得分高者优先，同分按提交先后，前 5（share 组件自行过滤在线）
    recommend: (o) => ({ perStudent }) => Object.entries(perStudent ?? {})
      .map(([name, r]) => ({ name, r, g: scoreOf(o, r) }))
      .filter((x) => x.g && typeof x.r.submittedAt === 'number')
      .sort((a, b) => (b.g.score / b.g.total) - (a.g.score / a.g.total) || a.r.submittedAt - b.r.submittedAt)
      .slice(0, 5)
      .map(({ name, g }) => ({ name, reason: `得分 ${g.score}/${g.total}` })),

    // 得分率 0–1；未提交 0；算不出（学生端揭晓前）→ null
    score: (o) => (record) => {
      if (!submitted(record)) return 0;
      const g = scoreOf(o, record);
      return g && g.total > 0 ? g.score / g.total : null;
    },

    summarize: (o) => (record, { perStudent } = {}) => {
      const total = o.items.length;
      if (o.showResultTo === 'never') {
        const n = o.items.filter((it) => isAnswered(record?.answers?.[it.id])).length;
        return [{ label: '作答', value: submitted(record) ? `已提交，答了 ${n} / ${total} 题` : '未提交' }];
      }
      const g = scoreOf(o, record);
      const mid = median(Object.values(perStudent ?? {}).map((r) => scoreOf(o, r)?.score));
      const items = [{ label: `我的得分（满分 ${total}）`, value: g ? g.score : '—', ...(mid != null ? { cohort: { median: mid } } : {}) }];
      if (submitted(record) && g?.results) items.push({ label: '错题号', value: formatNumbers(wrongNumbers(o, g.results)) });
      return items;
    },
  },
};
