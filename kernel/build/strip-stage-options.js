// 内核构建插件（活动原语规格 §2.8、契约 §五）：前端打包时去掉 stage.config.js 默认导出里的 options。
// 前端不需要它——原语阶段的有效 options 一律来自服务端 classroom:state.stages[i].options（学生版已去掉保密选项）；
// 留在打包文件里，学生用开发者工具就能读到 answer 等保密选项原文。服务端直接 import stage.config.js，不经过本插件。
//
// stripStageOptions({ stagesRoot })：stagesRoot 为本课阶段根目录的绝对路径（vite.config.js 由 resolveAliases 算出）。
// 只处理"阶段根目录下一层子目录里的 stage.config.js"，不看路径里有没有 /stages/。
//
// 规则（写法不合规一律构建失败，this.error 写明文件与改写要求）：
//   - 必须有 `export default` 声明；默认导出必须是对象字面量，或指向同文件顶层 `const` 对象字面量的标识符
//     （`export { cfg as default }`、`export default mk()`、import 进来的对象都不行——静态删不掉）
//   - 该对象的顶层不得有展开（`...base`）与计算属性名（`[k]: …`）
//   - 顶层的 options 属性（含 'options' 引号键）连同其后的逗号从源码文本删掉；嵌套对象里的 options 不动
//   - 默认导出再包一层运行时兜底：const __stageCfg = (…); delete __stageCfg.options; export default __stageCfg
// 纵深防御：transform 时记下被删 options 里 ≥ 8 字符的字符串字面量（标识符 / 枚举样的串除外，原语代码里也会出现），
// generateBundle 扫描输出的 chunk 与文本 asset，发现即构建失败（例如同一段文字又经别的具名导出被视图用到）。
// 用 this.parse（ESTree，偏移按 UTF-16 字符）与字符串切片，不引入 magic-string。
import fs from 'node:fs';
import path from 'node:path';

const MIN_LITERAL = 8;
const ENUM_LIKE = /^[A-Za-z_$][\w$-]*$/;
const REWRITE_HINT = '请改成 `export default { id, label, primitive, options: {…} }`（对象字面量），'
  + '或 `const cfg = {…}; export default cfg;`（同文件顶层 const 对象字面量），顶层不要用展开或计算属性名';

const toPosix = (p) => p.replace(/\\/g, '/');
function realOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

const keyName = (p) => {
  if (p.computed) return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal') return String(p.key.value);
  return null;
};

function topLevelConst(ast, name) {
  for (const node of ast.body) {
    const decl = node.type === 'VariableDeclaration' ? node
      : (node.type === 'ExportNamedDeclaration' && node.declaration && node.declaration.type === 'VariableDeclaration' ? node.declaration : null);
    if (!decl) continue;
    for (const d of decl.declarations) {
      if (d.id.type === 'Identifier' && d.id.name === name) return { kind: decl.kind, init: d.init };
    }
  }
  return null;
}

// 属性连同其后的逗号一起删
function removalOf(code, prop) {
  let end = prop.end;
  let i = end;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  if (code[i] === ',') end = i + 1;
  return { start: prop.start, end, text: '' };
}

// 子树里的字符串字面量（含模板字符串的静态片段）
function collectStrings(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectStrings(n, out);
    return;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
  if (node.type === 'TemplateElement' && node.value && typeof node.value.cooked === 'string') out.push(node.value.cooked);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'range' || k === 'loc') continue;
    if (v && typeof v === 'object') collectStrings(v, out);
  }
}

export default function stripStageOptions({ stagesRoot } = {}) {
  if (typeof stagesRoot !== 'string' || !stagesRoot) throw new Error('stripStageOptions：需要 stagesRoot（阶段根目录的绝对路径）');
  const roots = [...new Set([path.resolve(stagesRoot), realOrSelf(stagesRoot)].map(toPosix))];
  const secrets = new Map(); // 字符串 → 来源文件

  const isStageConfig = (file) => {
    if (path.posix.basename(file) !== 'stage.config.js') return false;
    const parent = path.posix.dirname(path.posix.dirname(file));
    return roots.includes(parent);
  };

  return {
    name: 'kernel:strip-stage-options',
    enforce: 'pre',

    buildStart() {
      secrets.clear();
    },

    transform(code, id) {
      const file = toPosix(String(id).split('?')[0]);
      if (!isStageConfig(file)) return null;
      const rel = path.posix.relative(path.posix.dirname(roots[0]), file) || file;
      const fail = (why) => this.error(`[strip-stage-options] ${rel}：${why}。${REWRITE_HINT}（前端打包必须删掉 options，保密选项不能进前端）`);

      const ast = this.parse(code);
      const exp = ast.body.find((n) => n.type === 'ExportDefaultDeclaration');
      if (!exp) return fail('找不到 `export default` 声明（`export { x as default }` 也不行）');
      const expr = exp.declaration;
      let obj = null;
      if (expr.type === 'ObjectExpression') obj = expr;
      else if (expr.type === 'Identifier') {
        const found = topLevelConst(ast, expr.name);
        if (!found || !found.init || found.init.type !== 'ObjectExpression') {
          return fail(`默认导出的 ${expr.name} 不是同文件顶层的对象字面量`);
        }
        if (found.kind !== 'const') return fail(`${expr.name} 必须用 const 声明`);
        obj = found.init;
      } else {
        return fail(`默认导出必须是对象字面量（现在是 ${expr.type}）`);
      }

      const edits = [];
      for (const p of obj.properties) {
        if (p.type === 'SpreadElement') return fail('默认导出对象的顶层不能用展开（...）');
        if (p.computed) return fail('默认导出对象的顶层不能用计算属性名（[key]: …）');
        if (keyName(p) === 'options') {
          const found = [];
          collectStrings(p.value, found);
          for (const s of found) if (s.length >= MIN_LITERAL && !ENUM_LIKE.test(s)) secrets.set(s, rel);
          edits.push(removalOf(code, p));
        }
      }
      edits.push({ start: exp.start, end: expr.start, text: 'const __stageCfg = (' });
      edits.push({
        start: expr.end,
        end: exp.end,
        text: ");\nif (__stageCfg && typeof __stageCfg === 'object' && 'options' in __stageCfg) delete __stageCfg.options;\nexport default __stageCfg;",
      });
      edits.sort((a, b) => b.start - a.start);
      let out = code;
      for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
      return { code: out, map: null };
    },

    generateBundle(_opts, bundle) {
      if (secrets.size === 0) return;
      for (const item of Object.values(bundle)) {
        let text = null;
        if (item.type === 'chunk') text = item.code;
        else if (item.type === 'asset' && typeof item.source === 'string') text = item.source;
        if (!text) continue;
        for (const [s, from] of secrets) {
          const escaped = JSON.stringify(s).slice(1, -1);
          if (text.includes(s) || text.includes(escaped)) {
            const shown = s.length > 24 ? `${s.slice(0, 24)}…` : s;
            this.error(`[strip-stage-options] 打包文件 ${item.fileName} 里出现了 ${from} 的 options 内容"${shown}"：`
              + '这段文字经别的途径（如具名导出、被视图 import）进了前端。options 只能写在默认导出里，前端从 classroom:state 读');
          }
        }
      }
    },
  };
}
