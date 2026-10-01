// coach：AI 对照要求逐条核（AI 对照要求逐条核规格 §3、§4）。纯模块、不引 Node：服务端 server.js 与客户端 client.jsx 共用。
// parseVerdicts(text, count) → { rows: [{ n, verdict: 'done' | 'missing' | 'unsure', note }], rest }
//   按行匹配"第 N 条：做到了 — 理由"（冒号半角 / 全角，分隔可为 — – - : ：或省略）；N 超出 1..count 或重复的丢弃；
//   其它非空行按原顺序进 rest（换行连接）；rows 按 n 升序
// requirementsOf(options) → 要求原文数组：code 的 options.requirements 在前、data-analysis 的 options.tasks 在后；
//   条目为字符串或 { text, hint }（只取 text），空的跳过——与 prompt.js 给 task 编号的顺序一致
// codeOf(record) → 该生本段代码：最终稿（record.final.code）非空优先，否则最近运行（record.code）；都空 → ''
// summarize(perStudent, items) → [{ n, text ≤ 60, done, missing, unsure }]：每条要求在 status 为 ok 的学生里的三种计数
// C7：reviewRows(rows) → [{ n, verdict, reason ≤ 200 }]：教师核对存每生每条用（parseVerdicts 的 note 改名 reason 并截断；学生 check 不走这里）
//   reviewNames(perStudent, n, verdict) → [{ name, reason }]：第 n 条判为 verdict 的学生与各自理由（只看 status ok，按名字排序）
export const VERDICT_OF = Object.freeze({ 做到了: 'done', 没做到: 'missing', 没法确认: 'unsure' });
export const SUMMARY_TEXT_MAX = 60;
export const REASON_MAX = 200;

const LINE = /^第\s*(\d+)\s*条\s*[：:]\s*(做到了|没做到|没法确认)\s*[—–\-:：]?\s*(.*)$/;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

export function parseVerdicts(text, count) {
  if (typeof text !== 'string') return { rows: [], rest: '' };
  const max = Number.isInteger(count) && count >= 0 ? count : Infinity;
  const seen = new Set();
  const rows = [];
  const rest = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m) {
      rest.push(line);
      continue;
    }
    const n = Number(m[1]);
    if (n < 1 || n > max || seen.has(n)) continue;
    seen.add(n);
    rows.push({ n, verdict: VERDICT_OF[m[2]], note: m[3].replace(/^[—–\-\s]+/, '').trim() });
  }
  rows.sort((a, b) => a.n - b.n);
  return { rows, rest: rest.join('\n') };
}

export function requirementsOf(options) {
  const o = isPlainObject(options) ? options : {};
  const list = [...(Array.isArray(o.requirements) ? o.requirements : []), ...(Array.isArray(o.tasks) ? o.tasks : [])];
  return list.map((r) => (typeof r === 'string' ? r : str(r?.text))).filter((s) => s !== '');
}

export function codeOf(record) {
  if (!isPlainObject(record)) return '';
  const fin = isPlainObject(record.final) ? str(record.final.code) : '';
  if (fin.trim() !== '') return fin;
  const code = str(record.code);
  return code.trim() !== '' ? code : '';
}

export function summarize(perStudent, items) {
  const list = Array.isArray(items) ? items : [];
  const out = list.map((t, i) => ({ n: i + 1, text: Array.from(str(t)).slice(0, SUMMARY_TEXT_MAX).join(''), done: 0, missing: 0, unsure: 0 }));
  for (const s of Object.values(isPlainObject(perStudent) ? perStudent : {})) {
    if (!isPlainObject(s) || s.status !== 'ok' || !Array.isArray(s.rows)) continue;
    for (const r of s.rows) {
      const row = out[r?.n - 1];
      if (row && (r.verdict === 'done' || r.verdict === 'missing' || r.verdict === 'unsure')) row[r.verdict]++;
    }
  }
  return out;
}

const VERDICTS = new Set(['done', 'missing', 'unsure']);
const cut = (s, max) => Array.from(s).slice(0, max).join('');

export function reviewRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => isPlainObject(r) && Number.isInteger(r.n) && VERDICTS.has(r.verdict))
    .map((r) => ({ n: r.n, verdict: r.verdict, reason: cut(str(r.note), REASON_MAX) }));
}

export function reviewNames(perStudent, n, verdict) {
  const out = [];
  for (const [name, s] of Object.entries(isPlainObject(perStudent) ? perStudent : {})) {
    if (!isPlainObject(s) || s.status !== 'ok' || !Array.isArray(s.rows)) continue;
    const row = s.rows.find((r) => isPlainObject(r) && r.n === n && r.verdict === verdict);
    if (row) out.push({ name, reason: str(row.reason) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}
