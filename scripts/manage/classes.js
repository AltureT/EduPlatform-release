// 班级（班级名单与按班分库规格 §2.1）：全平台共用，存在 data/classes.json = { next, classes: [{ id, name, names, updatedAt }] }
//   listClasses(root, { log }) → [...]（文件不存在或读不出 → []，读不出时记日志）
//   getClass(root, id) → 班级 | null
//   createClass(root, { name, names }) → 班级（id = c<next>：c1、c2…，删掉的号不复用；名字空 / 超长 / 重名 400）
//   updateClass(root, id, { name?, names? }) → 班级（找不到 404）
//   removeClassEntry(root, id) → 删掉的班级 | null（只删列表条目；库与备份由调用方移走）
//   currentClassId(root, env) → env.CLASS_ID 在列表里时它，否则 null（= 不分班）
//   CLASS_NAME_MAX = 20；名单规范化与名单导入同一规则（normalizeNames），可以为空（学生自己填名字）
//   写文件：先写临时文件再改名；原文件读不出时先改名为 classes.json.bad-<时间> 留底
import fs from 'node:fs';
import path from 'node:path';
import { normalizeNames } from '../../kernel/server/roster.js';
import { CLASS_ID_RE } from '../../kernel/server/lesson-db-path.js';

export const CLASS_NAME_MAX = 20;
export const CLASSES_FILE = 'data/classes.json';

const userError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
const fileOf = (root) => path.join(root, ...CLASSES_FILE.split('/'));

function readRaw(root) {
  const file = fileOf(root);
  if (!fs.existsSync(file)) return { classes: [], next: 1, broken: false };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(j?.classes) ? j.classes : [];
    const classes = list
      .filter((c) => c && typeof c.id === 'string' && CLASS_ID_RE.test(c.id) && typeof c.name === 'string')
      .map((c) => ({ id: c.id, name: c.name, names: normalizeNames(Array.isArray(c.names) ? c.names : []), updatedAt: c.updatedAt ?? null }));
    // next：下一个编号（删掉的号不复用，免得新班接手旧班留下的东西）
    const max = classes.reduce((m, c) => Math.max(m, Number(c.id.slice(1)) || 0), 0);
    const next = Math.max(Number.isInteger(j?.next) ? j.next : 1, max + 1);
    return { classes, next, broken: false };
  } catch {
    return { classes: [], next: 1, broken: true };
  }
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeAll(root, classes, next = readRaw(root).next) {
  const file = fileOf(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (readRaw(root).broken) fs.renameSync(file, `${file}.bad-${stamp()}`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify({ next, classes }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function listClasses(root, { log = () => {} } = {}) {
  const r = readRaw(root);
  if (r.broken) log(`[manage] 班级列表 ${CLASSES_FILE} 读不出来，按没有班级处理`);
  return r.classes;
}

export function getClass(root, id) {
  return readRaw(root).classes.find((c) => c.id === id) ?? null;
}

export function currentClassId(root, env) {
  const id = env?.CLASS_ID;
  if (!id) return null;
  return getClass(root, id) ? id : null;
}

function cleanName(name, classes, selfId = null) {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!n) throw userError('请先填班名');
  if ([...n].length > CLASS_NAME_MAX) throw userError(`班名太长了，最多 ${CLASS_NAME_MAX} 个字`);
  if (classes.some((c) => c.id !== selfId && c.name === n)) throw userError(`已经有一个"${n}"了，换个名字`);
  return n;
}

const cleanNames = (names) => {
  if (names === undefined) return undefined;
  if (!Array.isArray(names)) throw userError('名单格式不对');
  return normalizeNames(names);
};

export function createClass(root, { name, names = [] } = {}) {
  const { classes, next } = readRaw(root);
  const n = cleanName(name, classes);
  const c = { id: `c${next}`, name: n, names: cleanNames(names) ?? [], updatedAt: Date.now() };
  writeAll(root, [...classes, c], next + 1);
  return c;
}

export function updateClass(root, id, { name, names } = {}) {
  const { classes } = readRaw(root);
  const i = classes.findIndex((c) => c.id === id);
  if (i < 0) throw userError('找不到这个班，可能已经删掉了；请刷新页面', 404);
  const next = { ...classes[i], updatedAt: Date.now() };
  if (name !== undefined) next.name = cleanName(name, classes, id);
  const list = cleanNames(names);
  if (list !== undefined) next.names = list;
  const out = classes.slice();
  out[i] = next;
  writeAll(root, out);
  return next;
}

export function removeClassEntry(root, id) {
  const { classes } = readRaw(root);
  const hit = classes.find((c) => c.id === id);
  if (!hit) return null;
  writeAll(root, classes.filter((c) => c.id !== id));
  return hit;
}

// ===== 批量导入（班级名单与按班分库规格 §2.6）：粘贴全年级"班级、姓名"两列，自动建班、填名单 =====
//   parseClassRoster(text) → { classes: [{ name, names }], total, skipped, badClassNames }
//     每行按制表符或逗号分列（都没有时按空白分，且正好两段才算）；首行有"班级 / 姓名"这类表头时按表头找列（其它列如学号忽略），
//     没有表头时第一列是班级、第一个不全是数字的后续列是姓名；班级格空着（Excel 合并单元格复制出来的样子）沿用上一行的班级；
//     班级按出现顺序；同班同名只留一个；超过 16 字的名字、超过 20 字的班名跳过（计入 skipped / badClassNames）
//   importClasses(root, list) → { created: [班级], updated: [班级] }：按班名对上已有的班就替换名单，没有就新建（一次写入）
const CLASS_HEAD_RE = /^(班级|班|班别|班级名称|行政班|所在班级|class)$/i;
const NAME_HEAD_RE = /^(姓名|学生姓名|学生|名字|name)$/i;
const unquote = (c) => c.trim().replace(/^"([\s\S]*)"$/, '$1').trim();

export function parseClassRoster(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  for (const line of src.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue;
    let cells = /[,\t]/.test(line) ? line.split(/[,\t]/).map(unquote) : line.trim().split(/\s+/);
    if (!/[,\t]/.test(line) && cells.length !== 2) cells = [line.trim()];
    rows.push(cells);
  }
  const out = { classes: [], total: 0, skipped: 0, badClassNames: [] };
  if (!rows.length) return out;
  let ci = 0;
  let ni = -1;
  const head = rows[0];
  const hc = head.findIndex((c) => CLASS_HEAD_RE.test(c));
  const hn = head.findIndex((c) => NAME_HEAD_RE.test(c));
  if (hc >= 0 || hn >= 0) {
    rows.shift();
    if (hc >= 0) ci = hc;
    if (hn >= 0) ni = hn;
    else ni = ci === 0 ? 1 : 0;
    if (hc < 0) ci = ni === 0 ? 1 : 0;
  } else {
    // 没有表头：班级之后第一个不全是数字的列是姓名（跳过学号列）
    const width = Math.max(...rows.map((r) => r.length));
    for (let i = 1; i < width && ni < 0; i++) {
      const vals = rows.map((r) => r[i] ?? '').filter(Boolean);
      if (vals.length && !vals.every((v) => /^\d+$/.test(v))) ni = i;
    }
    if (ni < 0) ni = 1;
  }
  const groups = new Map();
  const bad = new Set();
  let last = '';
  for (const r of rows) {
    const rawClass = (r[ci] ?? '').replace(/\s+/g, ' ').trim();
    const name = (r[ni] ?? '').trim();
    const klass = rawClass || last;
    if (rawClass && name) last = rawClass; // 只有一格的行不改"上一行的班级"
    if (!klass || !name) {
      if (klass || name) out.skipped++;
      continue;
    }
    if ([...klass].length > CLASS_NAME_MAX) {
      bad.add(klass);
      out.skipped++;
      continue;
    }
    if (!groups.has(klass)) groups.set(klass, []);
    groups.get(klass).push(name);
  }
  for (const [name, list] of groups) {
    const names = normalizeNames(list);
    out.skipped += list.length - names.length;
    out.total += names.length;
    out.classes.push({ name, names });
  }
  out.badClassNames = [...bad];
  return out;
}

export function importClasses(root, list) {
  if (!Array.isArray(list) || list.length === 0) throw userError('没有解析出班级，请检查是否每行"班级、姓名"两列');
  const { classes, next } = readRaw(root);
  const out = classes.slice();
  let n = next;
  const created = [];
  const updated = [];
  const seen = new Set();
  for (const item of list) {
    const name = typeof item?.name === 'string' ? item.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const names = cleanNames(item.names ?? []) ?? [];
    const i = out.findIndex((c) => c.name === name);
    if (i >= 0) {
      out[i] = { ...out[i], names, updatedAt: Date.now() };
      updated.push(out[i]);
    } else {
      const c = { id: `c${n++}`, name: cleanName(name, out), names, updatedAt: Date.now() };
      out.push(c);
      created.push(c);
    }
  }
  if (!created.length && !updated.length) throw userError('没有解析出班级，请检查是否每行"班级、姓名"两列');
  writeAll(root, out, n);
  return { created, updated };
}
