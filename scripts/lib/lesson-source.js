// 课程源文件的静态读取工具（L1 check:lesson / new:stage 共用）：不执行代码，只做文本级判断
//   stripComments(src)：注释换成空格（保留换行与字符串），行号不变
//   lineAt(src, index) / findLine(src, re)：下标 → 行号（1 起）
//   walkFiles(dir, { skip }) → 相对 dir 的 posix 路径（排序；跳过点开头、node_modules 与 skip 里的目录名）
//   syntaxErrorAt(src, { lang? })：用 vite 的 parseAst 解析（lang 'jsx' 解析视图），有语法错误时返回 { line, message }，否则 null
//   moduleFacts(src) → { exports: Set<导出名>, localImports: [相对路径] } | null（语法错误时 null）：import / export 的静态事实
//   isPlainObject / toPosix
import fs from 'node:fs';
import path from 'node:path';

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const toPosix = (p) => String(p).replace(/\\/g, '/');

export function lineAt(src, index) {
  let n = 1;
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === '\n') n += 1;
  return n;
}

export function findLine(src, re) {
  const m = re.exec(src);
  return m ? lineAt(src, m.index) : null;
}

// 注释 → 空格（换行保留）；字符串与模板字面量原样保留（事件名、<Page template="…"> 都在字符串里）
export function stripComments(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e === -1 ? n : e;
      blank(i, end);
      i = end;
    } else if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e === -1 ? n : e + 2;
      blank(i, end);
      i = end;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j += 1;
        else if (src[j] === '\n' && c !== '`') break; // 未闭合（JSX 文本里的撇号）：到行尾为止
        j += 1;
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

export function walkFiles(dir, { skip = [] } = {}) {
  const out = [];
  const visit = (abs, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || skip.includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  visit(dir, '');
  return out.sort();
}

let parseAstFn = null;
export async function loadParseAst() {
  if (!parseAstFn) ({ parseAst: parseAstFn } = await import('vite'));
  return parseAstFn;
}

// lang：'jsx' 解析 .jsx（缺省按普通 JS）
export async function syntaxErrorAt(src, { lang } = {}) {
  const parseAst = await loadParseAst();
  try {
    parseAst(src, lang ? { lang } : undefined);
    return null;
  } catch (err) {
    const first = String(err?.message ?? err).split('\n').map((l) => l.trim()).filter(Boolean);
    // rolldown：'Parse failed with 1 error:' 之后一行是具体原因
    const message = first.find((l) => !/^Parse failed/.test(l)) ?? first[0] ?? '语法错误';
    return { line: Number.isInteger(err?.pos) ? lineAt(src, err.pos) : null, message };
  }
}

// 顶层 import / export 的静态事实（不执行代码）
export async function moduleFacts(src, { lang } = {}) {
  const parseAst = await loadParseAst();
  let ast;
  try {
    ast = parseAst(src, lang ? { lang } : undefined);
  } catch {
    return null;
  }
  const exports = new Set();
  const localImports = [];
  const isLocal = (s) => typeof s === 'string' && (s.startsWith('./') || s.startsWith('../'));
  const addPattern = (id) => {
    if (id?.type === 'Identifier') exports.add(id.name);
    else if (id?.type === 'ObjectPattern') for (const p of id.properties) addPattern(p.value ?? p.argument);
    else if (id?.type === 'ArrayPattern') for (const el of id.elements) addPattern(el);
  };
  for (const node of ast.body) {
    if (node.source && isLocal(node.source.value)) localImports.push(node.source.value);
    if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d?.type === 'FunctionDeclaration' || d?.type === 'ClassDeclaration') exports.add(d.id.name);
      else if (d?.type === 'VariableDeclaration') for (const v of d.declarations) addPattern(v.id);
      for (const s of node.specifiers ?? []) exports.add(s.exported.type === 'Identifier' ? s.exported.name : String(s.exported.value));
    } else if (node.type === 'ExportDefaultDeclaration') exports.add('default');
    else if (node.type === 'ExportAllDeclaration') exports.add('*');
  }
  return { exports, localImports };
}
