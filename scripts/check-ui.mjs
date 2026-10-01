#!/usr/bin/env node
// npm run check:ui（界面整理规格 §6）：阶段与组件目录不得自写布局。
// 扫描 examples/*/stages/**/*.jsx、components/*/**/*.jsx 与 primitives/*/**/*.jsx（v0.8；排除 __tests__；kernel/ 不扫），
// C5：另扫课程本地组件 examples/*/components/*/**/*.jsx 与 lessons/*/components/*/**/*.jsx，
// 命中即列出 文件:行 并退出 1：
//   position       position: fixed | absolute（覆盖层走内核 Overlay；sticky / relative 允许）
//   size           数值 height / minHeight / width > 64；JSX 属性 height={300} 同样（canvas / svg / img / video / iframe 豁免）；
//                  maxWidth / maxHeight 允许
//   viewport-unit  vh / vw（含 dvh / svh / lvh）单位
//   media          @media
//   page-root      stages 与 primitives 下 Student.jsx / TeacherDemo.jsx 的默认导出组件，顶层 return 须是 <Page …>
//                  （早退 return null 允许；三元两个分支都查）
//   advance        stages 与 primitives 下 TeacherStats.jsx / TeacherDemo.jsx 出现 advance(（推进在外壳操作条，契约 v0.7）
// 只看代码：注释、模板字面量整体跳过；字符串字面量只保留样式对象的键与值（如 { position: 'fixed' }）
//   和纯数字的 JSX 属性值（height="300"），其余字符串与 JSX 文本跳过，不误报。
// 行尾写 // check-ui-ignore-line 忽略该行的全部命中。
// 提醒（warning，只打印、不影响退出码）：
//   draft          D1（学生输入自动保存规格 §2.4）：自写段 stages/*/Student.jsx 里有 <textarea / <input 却没用 useDraft
//                  （学生输入一律 useDraft，刷新、断线、关浏览器、换设备不丢）；原语不在此列
// 用法：node scripts/check-ui.mjs [路径前缀…]   不带参数扫全部；带参数只报这些前缀下的文件（如 examples/minimal、primitives/vote）
// 扫描范围里 0 个文件时退出 1（前缀写错或目录改名时不能静默通过）；U4：路径参数逐个校验，任一匹配不到文件即列出并退出 1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SIZE_LIMIT = 64;
const PAGE_FILES = new Set(['Student.jsx', 'TeacherDemo.jsx']);
const ADVANCE_FILES = new Set(['TeacherStats.jsx', 'TeacherDemo.jsx']);
const MEDIA_TAGS = new Set(['canvas', 'svg', 'img', 'video', 'iframe']);
const IGNORE = 'check-ui-ignore-line';

const fillRange = (out, a, b) => { for (let k = a; k < b; k += 1) if (out[k] !== '\n') out[k] = ' '; };

// 源码 → 等长"代码视图"：注释与模板字面量换成空格（保留换行）；字符串字面量按 keepString(src, start, end) 决定是否保留内容。
// 返回 { code, strings: [{ start, end }] }
function codeView(src, keepString = () => false) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e === -1 ? n : e;
      fillRange(out, i, end);
      i = end;
    } else if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e === -1 ? n : e + 2;
      fillRange(out, i, end);
      i = end;
    } else if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (depth === 0 && src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') { depth += 1; j += 2; continue; }
        if (depth > 0 && src[j] === '}') depth -= 1;
        j += 1;
      }
      fillRange(out, i + 1, Math.min(j, n));
      i = j + 1;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j += 1;
        else if (src[j] === '\n') break; // 未闭合（多半是 JSX 文本里的撇号）：到行尾为止
        j += 1;
      }
      const end = Math.min(j, n);
      if (!keepString(src, i, end)) fillRange(out, i + 1, end);
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

// 样式对象的键 / 值，或纯数字的 JSX 属性值 → 保留
function keepStyleString(src, start, end) {
  let a = start - 1;
  while (a >= 0 && /[ \t\r\n]/.test(src[a])) a -= 1;
  if (src[a] === ':' && src[a - 1] !== '?') return true; // 值
  let b = end + 1;
  while (b < src.length && /[ \t\r\n]/.test(src[b])) b += 1;
  if (src[b] === ':' && src[a] !== '?') return true; // 键（三元的 ? '…' : 不算）
  if (src[a] === '=' && /^\s*\d+(\.\d+)?(px)?\s*$/.test(src.slice(start + 1, end))) return true; // height="300"
  return false;
}

// JSX 文本（> 与 < / { 之间、不像代码的片段）换成空格
function blankJsxText(code) {
  const out = code.split('');
  const re = />([^<{>]*)(?=[<{])/g;
  let m;
  while ((m = re.exec(code))) {
    const at = m.index;
    if (code[at - 1] === '=' || code[at + 1] === '=') continue; // => 与 >=
    const text = m[1];
    if (/[;=(){}[\]&|?]/.test(text)) continue;
    fillRange(out, at + 1, at + 1 + text.length);
  }
  return out.join('');
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

// 从 open 处（'(' '{' '['）找匹配的闭合下标
function matchClose(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

// idx 处的 JSX 属性属于哪个标签：向前找 <Tag，跳过 {…}，中途遇到 > 则不在标签里
function tagOf(code, idx) {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (code[i] === '}') {
      let depth = 0;
      for (; i >= 0; i -= 1) {
        if (code[i] === '}') depth += 1;
        else if (code[i] === '{') { depth -= 1; if (depth === 0) break; }
      }
      continue;
    }
    if (code[i] === '>') return null;
    if (code[i] === '<') {
      const m = /^<([A-Za-z][\w.]*)/.exec(code.slice(i, i + 64));
      return m ? m[1] : null;
    }
  }
  return null;
}

const LINE_RULES = [
  {
    rule: 'position',
    re: /\bposition\s*:\s*['"]?\s*(fixed|absolute)\b/g,
    message: (m) => `position: ${m[1]}（覆盖层请用内核 Overlay）`,
  },
  {
    rule: 'size',
    re: /(?<![A-Za-z0-9_-])(height|minHeight|width|min-height)\s*:\s*['"]?\s*(\d+(?:\.\d+)?)(px)?\s*(?=['",;})\s]|$)/g,
    test: (m) => Number(m[2]) > SIZE_LIMIT,
    message: (m) => `${m[1]}: ${m[2]}${m[3] || ''} 超过 ${SIZE_LIMIT} px（尺寸交给 <Page> 与布局原语）`,
  },
  {
    rule: 'size',
    re: /(?<![A-Za-z0-9_-])(height|width)=\{?\s*['"]?\s*(\d+(?:\.\d+)?)(px)?\s*['"]?\s*\}?/g,
    test: (m, code) => Number(m[2]) > SIZE_LIMIT && !MEDIA_TAGS.has(String(tagOf(code, m.index)).toLowerCase()),
    message: (m) => `${m[1]}=${m[2]} 超过 ${SIZE_LIMIT} px`,
  },
  {
    rule: 'viewport-unit',
    re: /(?<![A-Za-z0-9_.])\d+(?:\.\d+)?[dsl]?v[hw]\b/g,
    message: (m) => `视口单位 ${m[0]}`,
  },
  {
    rule: 'media',
    re: /@media\b/g,
    message: () => '@media（断点由外壳与布局原语处理）',
  },
];

function ruleHits(src, file, code) {
  const raw = src.split('\n');
  const hits = [];
  for (const r of LINE_RULES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(code))) {
      if (r.test && !r.test(m, code)) continue;
      const line = lineOf(code, m.index);
      hits.push({ file, line, rule: r.rule, message: r.message(m), snippet: raw[line - 1].trim() });
    }
  }
  return hits;
}

// ---------- page-root ----------
function defaultComponentBody(code) {
  let m = /export\s+default\s+function\b[^(]*\(/.exec(code);
  if (m) return bodyAfterParams(code, m.index + m[0].length - 1);
  m = /export\s+default\s+(?:async\s+)?\(/.exec(code);
  if (m) return bodyAfterParams(code, m.index + m[0].length - 1);
  m = /export\s+default\s+(?:React\.)?(?:memo|forwardRef)\s*\(\s*function\b[^(]*\(/.exec(code);
  if (m) return bodyAfterParams(code, m.index + m[0].length - 1);
  m = /export\s+default\s+(?:React\.)?(?:memo|forwardRef)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(code)
    || /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(code);
  if (!m) return null;
  const name = m[1];
  let d = new RegExp(`function\\s+${name}\\s*\\(`).exec(code);
  if (d) return bodyAfterParams(code, d.index + d[0].length - 1);
  d = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:function\\s*[\\w$]*\\s*)?\\(`).exec(code);
  if (d) return bodyAfterParams(code, d.index + d[0].length - 1);
  return null;
}

function bodyAfterParams(code, parenIdx) {
  const close = matchClose(code, parenIdx);
  if (close === -1) return null;
  let i = skipWs(code, close + 1);
  if (code.startsWith('=>', i)) i = skipWs(code, i + 2);
  if (code[i] === '{') {
    const end = matchClose(code, i);
    return end === -1 ? null : { kind: 'block', start: i, end };
  }
  return { kind: 'expr', start: i };
}

function skipWs(code, i) {
  while (i < code.length && /\s/.test(code[i])) i += 1;
  return i;
}

// JSX 元素结束位置（code[i] === '<'），失败返回 -1
function jsxEnd(code, i) {
  let k = i + 1;
  while (k < code.length && code[k] !== '>') {
    if (code[k] === '{') { k = matchClose(code, k); if (k === -1) return -1; }
    k += 1;
  }
  if (k >= code.length) return -1;
  if (code[k - 1] === '/') return k + 1;
  k += 1;
  while (k < code.length) {
    const c = code[k];
    if (c === '{') { k = matchClose(code, k); if (k === -1) return -1; k += 1; continue; }
    if (c === '<') {
      if (code[k + 1] === '/') {
        const e = code.indexOf('>', k);
        return e === -1 ? -1 : e + 1;
      }
      k = jsxEnd(code, k);
      if (k === -1) return -1;
      continue;
    }
    k += 1;
  }
  return -1;
}

const IS_PAGE = /^<Page[\s>/]/;

// 解析 return 后的表达式：JSX、null/undefined/false、括号、三元（两个分支都查）
// → { ok: 都是 <Page> 或空, hasPage, end } ；无法识别返回 { ok: false }
function parseReturn(code, i, depth = 0) {
  if (depth > 20) return { ok: false };
  i = skipWs(code, i);
  const head = code.slice(i, i + 16);
  if (code[i] === '(') {
    const close = matchClose(code, i);
    if (close === -1) return { ok: false };
    const inner = parseReturn(code, i + 1, depth + 1);
    if (!inner.ok && inner.end == null) return { ok: false };
    return { ...inner, end: close + 1 };
  }
  if (code[i] === '<') {
    const end = jsxEnd(code, i);
    const page = IS_PAGE.test(code.slice(i, i + 8));
    return { ok: page, hasPage: page, end: end === -1 ? i + 1 : end };
  }
  const nothing = /^(null|undefined|false)\b/.exec(head);
  if (nothing) return { ok: true, hasPage: false, end: i + nothing[0].length };
  // 条件 ? a : b
  let q = -1;
  for (let k = i; k < code.length; k += 1) {
    const c = code[k];
    if (c === '(' || c === '[' || c === '{') { k = matchClose(code, k); if (k === -1) return { ok: false }; continue; }
    if (c === ';' || c === ')' || c === '}' || c === ']') break;
    if (c === '?' && code[k + 1] !== '.' && code[k + 1] !== '?' && code[k - 1] !== '?') { q = k; break; }
  }
  if (q === -1) return { ok: false };
  const cons = parseReturn(code, q + 1, depth + 1);
  if (cons.end == null) return { ok: false };
  const colon = skipWs(code, cons.end);
  if (code[colon] !== ':') return { ok: false };
  const alt = parseReturn(code, colon + 1, depth + 1);
  return { ok: !!(cons.ok && alt.ok), hasPage: !!(cons.hasPage || alt.hasPage), end: alt.end };
}

function pageRootHits(src, file, code) {
  const body = defaultComponentBody(code);
  const hit = (idx, message) => {
    const line = lineOf(src, idx);
    return [{ file, line, rule: 'page-root', message, snippet: src.split('\n')[line - 1].trim() }];
  };
  if (!body) return hit(0, '找不到默认导出的组件（Student.jsx / TeacherDemo.jsx 须默认导出组件，根为 <Page>）');
  if (body.kind === 'expr') {
    const r = parseReturn(code, body.start);
    return r.ok && r.hasPage ? [] : hit(body.start, '默认导出组件的根不是 <Page>');
  }
  const returns = [];
  let depth = 0;
  for (let i = body.start; i <= body.end; i += 1) {
    const c = code[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (depth === 1 && code.startsWith('return', i) && !/[\w$]/.test(code[i - 1] || '') && !/[\w$]/.test(code[i + 6] || '')) {
      returns.push({ idx: i, r: parseReturn(code, i + 6) });
      i += 5;
    }
  }
  if (returns.length === 0) return hit(body.start, '默认导出组件没有顶层 return <Page>');
  const bad = returns.find((x) => !x.r.ok);
  if (bad) return hit(bad.idx, '顶层 return 不是 <Page>（阶段视图的根必须是 <Page>；三元的两个分支都要是）');
  if (!returns.some((x) => x.r.hasPage)) return hit(returns[returns.length - 1].idx, '顶层 return 不是 <Page>');
  return [];
}

function advanceHits(src, file, code) {
  const raw = src.split('\n');
  const hits = [];
  const re = /(?<![\w$])advance\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const line = lineOf(code, m.index);
    hits.push({ file, line, rule: 'advance', message: 'advance(…)：推进由外壳操作条提供，TeacherStats / TeacherDemo 不再放推进按钮（契约 v0.7）', snippet: raw[line - 1].trim() });
  }
  return hits;
}

export function scanSource(src, file, { requirePage } = {}) {
  const base = path.posix.basename(file);
  // v0.8：原语的默认视图与阶段视图同规则
  const inStages = /(^|\/)(stages|primitives)\//.test(file);
  const styleCode = blankJsxText(codeView(src, keepStyleString));
  const hits = ruleHits(src, file, styleCode);
  const needPage = requirePage ?? (PAGE_FILES.has(base) && inStages);
  const structCode = codeView(src);
  if (needPage) hits.push(...pageRootHits(src, file, structCode));
  if (inStages && ADVANCE_FILES.has(base)) hits.push(...advanceHits(src, file, structCode));
  const raw = src.split('\n');
  return hits
    .filter((h) => !(raw[h.line - 1] || '').includes(IGNORE))
    .sort((a, b) => a.line - b.line);
}

// D1：自写段 Student.jsx 有输入框却没用 useDraft → 提醒（第一处输入框所在行）
export function draftWarnings(src, file) {
  if (path.posix.basename(file) !== 'Student.jsx' || !/(^|\/)stages\//.test(file)) return [];
  const code = codeView(src);
  if (/\buseDraft\b/.test(code)) return [];
  const m = /<(textarea|input)\b/.exec(code);
  if (!m) return [];
  const line = code.slice(0, m.index).split('\n').length;
  const raw = src.split('\n');
  if ((raw[line - 1] || '').includes(IGNORE)) return [];
  return [{
    file, line, rule: 'draft', level: 'warning',
    message: `有 <${m[1]}> 输入框但没用 useDraft：学生输入一律 useDraft（刷新、断线、关浏览器、换设备不丢），不用裸 useState`,
    snippet: raw[line - 1].trim(),
  }];
}

export function checkUiWarnings(root, only = []) {
  const out = [];
  for (const f of targetsFor(root, only)) out.push(...draftWarnings(fs.readFileSync(path.join(root, f), 'utf8'), f));
  return out;
}

function walk(dir, rel, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    if (e.name === '__tests__' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(abs, r, out);
    else if (e.isFile() && e.name.endsWith('.jsx')) out.push(r);
  }
}

const subdirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch (_) {
    return [];
  }
};

// examples/*/stages/**/*.jsx、components/*/**/*.jsx 与 primitives/*/**/*.jsx（排除 __tests__），相对 root 的 posix 路径，排序
// C5：加课程本地组件 examples/*/components/*/**/*.jsx、lessons/*/components/*/**/*.jsx
export function listTargets(root) {
  const out = [];
  for (const lesson of subdirs(path.join(root, 'examples'))) {
    walk(path.join(root, 'examples', lesson, 'stages'), `examples/${lesson}/stages`, out);
  }
  for (const top of ['examples', 'lessons']) {
    for (const lesson of subdirs(path.join(root, top))) {
      for (const comp of subdirs(path.join(root, top, lesson, 'components'))) {
        walk(path.join(root, top, lesson, 'components', comp), `${top}/${lesson}/components/${comp}`, out);
      }
    }
  }
  for (const comp of subdirs(path.join(root, 'components'))) {
    walk(path.join(root, 'components', comp), `components/${comp}`, out);
  }
  for (const prim of subdirs(path.join(root, 'primitives'))) {
    walk(path.join(root, 'primitives', prim), `primitives/${prim}`, out);
  }
  return out.sort();
}

const normPrefix = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const underPrefix = (f, p) => f === p || f.startsWith(`${p}/`);

function targetsFor(root, only = []) {
  const prefixes = only.map(normPrefix);
  return listTargets(root).filter((f) => prefixes.length === 0 || prefixes.some((p) => underPrefix(f, p)));
}

// U4：逐个校验路径参数——返回扫描范围里一个文件也匹配不到的参数（路径不存在、写错，或不在 examples/*/stages、components/*、primitives/*、examples|lessons/*/components/* 内），原样返回
export function emptyPrefixes(root, only = []) {
  const files = listTargets(root);
  return only.filter((raw) => {
    const p = normPrefix(raw);
    return !files.some((f) => underPrefix(f, p));
  });
}

export function checkUi(root, only = []) {
  const files = targetsFor(root, only);
  const hits = [];
  for (const f of files) hits.push(...scanSource(fs.readFileSync(path.join(root, f), 'utf8'), f));
  return hits;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const only = process.argv.slice(2);
  const scope = only.length ? only.join(', ') : 'examples/*/stages、components/*、primitives/*、课程组件';
  const missing = emptyPrefixes(root, only);
  if (missing.length) {
    for (const m of missing) console.log(`check:ui：${m} 下没有可扫描的 .jsx 文件（路径不存在、写错，或不在 examples/*/stages、components/*、primitives/*、examples|lessons/*/components/* 内）`);
    console.log(`\ncheck:ui：${missing.length} 个路径参数无效，未扫描`);
    process.exit(1);
  }
  const count = targetsFor(root, only).length;
  if (count === 0) {
    console.log(`check:ui：${scope} 下没有可扫描的 .jsx 文件（路径前缀写错？）`);
    process.exit(1);
  }
  const hits = checkUi(root, only);
  for (const h of hits) console.log(`${h.file}:${h.line}: [${h.rule}] ${h.message} — ${h.snippet}`);
  const warnings = checkUiWarnings(root, only);
  for (const w of warnings) console.log(`${w.file}:${w.line}: [提醒:${w.rule}] ${w.message} — ${w.snippet}`);
  if (hits.length) {
    const files = new Set(hits.map((h) => h.file)).size;
    console.log(`\ncheck:ui：${scope} 共 ${hits.length} 处命中（${files} 个文件）`);
    process.exit(1);
  }
  console.log(`check:ui：${scope} 通过（${count} 个文件${warnings.length ? `，${warnings.length} 条提醒` : ''}）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
