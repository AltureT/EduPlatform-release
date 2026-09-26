// 配置文件的文本级改写（L1 new:stage）：在 lesson.config.js 默认导出对象的某个数组属性里插入一个字符串，保留注释与原有排版
//   insertArrayItem(src, key, value, { index? }) → 新源码
//     默认导出须为对象字面量，或指向同文件顶层 const 对象字面量的标识符（与构建插件的要求相同）；属性值须为数组字面量
//     单行数组：原位插入 ', 'value''；多行数组：按首项缩进另起一行（尾逗号风格跟随原文）；空数组：[ 'value' ]
//     index 缺省追加到末尾；引号风格跟随第一项（缺省单引号）
//   quoteJs(s, q?) → JS 字符串字面量
import { loadParseAst } from './lesson-source.js';

export function quoteJs(s, q = "'") {
  const body = String(s).replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  return q === '"' ? `"${body.replace(/"/g, '\\"')}"` : `'${body.replace(/'/g, "\\'")}'`;
}

const keyName = (p) => {
  if (p.type !== 'Property' || p.computed) return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal') return String(p.key.value);
  return null;
};

export async function defaultObject(src) {
  const parseAst = await loadParseAst();
  const ast = parseAst(src);
  const exp = ast.body.find((n) => n.type === 'ExportDefaultDeclaration');
  if (!exp) throw new Error('找不到 export default，没法自动改写（请改成 export default { … } 对象字面量）');
  let obj = exp.declaration;
  if (obj.type === 'Identifier') {
    const name = obj.name;
    obj = null;
    for (const node of ast.body) {
      const decl = node.type === 'VariableDeclaration' ? node
        : (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration' ? node.declaration : null);
      const d = decl?.kind === 'const' ? decl.declarations.find((x) => x.id.type === 'Identifier' && x.id.name === name) : null;
      if (d) obj = d.init;
    }
  }
  if (!obj || obj.type !== 'ObjectExpression') throw new Error('默认导出不是对象字面量，没法自动改写（请改成 export default { … }）');
  return obj;
}

const lineStartOf = (src, i) => src.lastIndexOf('\n', i - 1) + 1;
const lineEndOf = (src, i) => {
  const e = src.indexOf('\n', i);
  return e === -1 ? src.length : e;
};
// 从 i 起跳过空白与行内注释，只剩换行 / 文件尾则为 true
const restIsBlank = (src, i) => /^[ \t]*(\/\/[^\n]*|\/\*[^\n]*?\*\/[ \t]*)?(\r?\n|$)/.test(src.slice(i));

export async function insertArrayItem(src, key, value, { index } = {}) {
  const obj = await defaultObject(src);
  const prop = obj.properties.find((p) => keyName(p) === key);
  if (!prop || prop.value.type !== 'ArrayExpression') {
    throw new Error(`默认导出里的 ${key} 不是数组字面量，没法自动改写（请写成 ${key}: [ … ]）`);
  }
  const arr = prop.value;
  const els = arr.elements;
  if (els.some((e) => e === null || e.type === 'SpreadElement')) throw new Error(`${key} 数组里有空位或展开，没法自动改写`);
  const q = els.length && src[els[0].start] === '"' ? '"' : "'";
  const text = quoteJs(value, q);
  const at = Number.isInteger(index) ? Math.max(0, Math.min(index, els.length)) : els.length;
  const splice = (pos, ins) => src.slice(0, pos) + ins + src.slice(pos);

  if (els.length === 0) {
    const inner = src.slice(arr.start + 1, arr.end - 1);
    if (inner.trim() === '') return src.slice(0, arr.start) + `[${text}]` + src.slice(arr.end);
    // 只含注释的空数组：保留注释，插在 ] 之前（多行时另起一行，缩进跟随注释）
    const close = arr.end - 1;
    const ls = lineStartOf(src, close);
    if (inner.includes('\n') && /^[ \t]*$/.test(src.slice(ls, close))) {
      const firstLine = inner.split('\n').find((l) => l.trim() !== '') ?? '';
      const indent = firstLine.match(/^[ \t]*/)[0];
      return splice(ls, `${indent}${text},\n`);
    }
    const before = src.slice(0, close).replace(/[ \t]+$/, '');
    return `${before} ${text}` + src.slice(close);
  }
  const multiline = src.slice(arr.start, arr.end).includes('\n');
  if (!multiline) {
    return at < els.length ? splice(els[at].start, `${text}, `) : splice(els.at(-1).end, `, ${text}`);
  }
  const first = els[0];
  const indent = src.slice(lineStartOf(src, first.start), first.start).match(/^[ \t]*/)[0];
  if (at < els.length) {
    const el = els[at];
    const ls = lineStartOf(src, el.start);
    if (/^[ \t]*$/.test(src.slice(ls, el.start))) return splice(ls, `${indent}${text},\n`);
    return splice(el.start, `${text}, `);
  }
  const last = els.at(-1);
  let p = last.end;
  while (p < src.length && /[ \t]/.test(src[p])) p += 1;
  const hasComma = src[p] === ',';
  const after = hasComma ? p + 1 : last.end;
  if (!restIsBlank(src, after)) return splice(last.end, `, ${text}`);
  const eol = lineEndOf(src, after);
  const withNew = splice(eol, `\n${indent}${text}${hasComma ? ',' : ''}`);
  return hasComma ? withNew : withNew.slice(0, last.end) + ',' + withNew.slice(last.end);
}
