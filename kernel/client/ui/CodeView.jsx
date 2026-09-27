// <CodeView>（代码展示统一高亮规格 §2）：只读展示一段代码，Python 语法高亮，颜色走 --code-* 令牌（与编辑器同一套）。
//   <CodeView code lang="python" size="sm"|"md" wrap={false} maxLines={n} data-testid … />
// - 渲染 <pre data-ui="code-view" class="code-view">，按 token 输出 <span class="tok-<name>">，其余文本原样；不加行号；textContent === code
// - 高亮只用 @lezer/python 的 parser + @lezer/highlight 的 highlightCode / tagHighlighter（不从 @codemirror/lang-python 取，免得把 view / state 拖进来）
// - lang 只认 python；其它值（text / json）只等宽不高亮；超过 HIGHLIGHT_MAX 字也不高亮（大文本不卡）
// - size：sm → --fs-sm，md → --fs-md；wrap：true 时 pre-wrap（提示块、大屏），否则 pre + 横向滚动
// - maxLines：超过时 <pre> 里只放前 n 行，<pre> 之后另起一行"…还有 N 行"（data-code-more；不做展开）
// - 不收 style；className、data-* / aria-* / id / title 落在 <pre> 上
import { useMemo } from 'react';
import { highlightCode, tagHighlighter } from '@lezer/highlight';
import { parser } from '@lezer/python';
import { CODE_TOKENS } from './codeTokens.js';

export const HIGHLIGHT_MAX = 20000;

const highlighter = tagHighlighter(CODE_TOKENS.map(({ name, tag }) => ({ tag, class: `tok-${name}` })));

// 代码 → React 子节点数组（无 token 的文本与换行并成字符串，token 为 <span className>）
export function highlightPython(code) {
  const out = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push(plain);
    plain = '';
  };
  highlightCode(
    code,
    parser.parse(code),
    highlighter,
    (text, classes) => {
      if (!classes) {
        plain += text;
        return;
      }
      flush();
      out.push(<span key={out.length} className={classes}>{text}</span>);
    },
    () => { plain += '\n'; },
  );
  flush();
  return out;
}

// 行数：末尾换行不算多出一行；空串 0 行
export const lineCount = (code) => (code === '' ? 0 : code.replace(/\n$/, '').split('\n').length);

const SIZES = new Set(['sm', 'md']);
const passThrough = (rest) => Object.fromEntries(
  Object.entries(rest).filter(([k]) => k.startsWith('data-') || k.startsWith('aria-') || k === 'id' || k === 'title'),
);

export default function CodeView({ code, lang = 'python', size = 'sm', wrap = false, maxLines, className, ...rest }) {
  const src = typeof code === 'string' ? code : String(code ?? '');
  const sz = SIZES.has(size) ? size : 'sm';
  const limit = Number.isInteger(maxLines) && maxLines > 0 ? maxLines : null;
  const total = limit != null ? lineCount(src) : 0;
  const cut = limit != null && total > limit;
  const shown = cut ? src.split('\n').slice(0, limit).join('\n') : src;
  const children = useMemo(
    () => (lang === 'python' && shown.length <= HIGHLIGHT_MAX ? highlightPython(shown) : shown),
    [shown, lang],
  );
  const style = {
    margin: 0,
    padding: sz === 'md' ? 'var(--sp-3)' : 'var(--sp-2)',
    fontFamily: 'var(--font-mono)',
    fontSize: `var(--fs-${sz})`,
    lineHeight: 1.5,
    color: 'var(--code-variable)',
    background: 'var(--code-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    userSelect: 'text',
    ...(wrap ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : { whiteSpace: 'pre', overflowX: 'auto' }),
  };
  const pre = (
    <pre {...passThrough(rest)} data-ui="code-view" className={className ? `code-view ${className}` : 'code-view'} style={style}>
      {children}
    </pre>
  );
  if (!cut) return pre;
  return (
    <>
      {pre}
      <div data-code-more="" style={{ marginTop: 'var(--sp-1)', color: 'var(--ink-dim)', fontSize: `var(--fs-${sz})` }}>
        {`…还有 ${total - limit} 行`}
      </div>
    </>
  );
}
