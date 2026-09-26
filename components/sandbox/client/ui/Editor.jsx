// 代码编辑器（界面整理规格 §5）：CodeMirror 6，随应用打包
// - Python 高亮；补全 = 关键词 + 内置函数 + 文档内标识符（localCompletionSource）+ 阶段传入的 extraCompletions
// - 括号 / 引号自动配对、括号匹配、自动缩进（4 空格）、Tab / Shift+Tab 缩进、Ctrl/Cmd+Enter → onRun、历史撤销、行号、当前行高亮
// - 软换行关闭（横向滚动）；只读 = EditorState.readOnly + EditorView.editable（镜像与非 live 阶段）
// - 浅色主题固定（平台令牌配色，不提供切换）；字号 16 px（iOS 聚焦不放大，规格 v0.2.2 §5）、等宽；contentAttributes 关掉自动大写 / 纠错 / 拼写检查
// - 补全：唯一候选就是当前词时不弹（否则打完 pass 停顿后回车会被补全吃掉）；文档内标识符与 extraCompletions 按名去重
// - 输入法组字（isComposing / keyCode 229）期间不处理任何快捷键
// - 受控：value 变化且与文档不同时以最小区间替换（不进撤销栈、不回调 onChange）；用户修改回调 onChange(新文本)
// - ref 暴露 { indentMore, indentLess, focus }（平板工具栏 [→缩进] [←] 用）
// - 高度不由本组件决定：根元素 flex: 1 撑满父级（PyRunner 里是 <Split> 的一格）
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Annotation, Compartment, EditorState, Prec, Transaction } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
} from '@codemirror/view';
import {
  bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting,
} from '@codemirror/language';
import { python, localCompletionSource } from '@codemirror/lang-python';
import {
  autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, ifNotIn,
} from '@codemirror/autocomplete';
import {
  defaultKeymap, history, historyKeymap, indentLess, indentMore, indentWithTab,
} from '@codemirror/commands';
import { MONO } from './mono.js';

export const EDITOR_FONT_PX = 16;
const FONT = `${EDITOR_FONT_PX}px`;

// ---------- 补全源 ----------

const KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
];
const BUILTINS = [
  'abs', 'all', 'any', 'bin', 'bool', 'chr', 'dict', 'dir', 'divmod', 'enumerate', 'filter', 'float', 'format',
  'getattr', 'hasattr', 'hex', 'input', 'int', 'isinstance', 'iter', 'len', 'list', 'map', 'max', 'min', 'next',
  'open', 'ord', 'pow', 'print', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'sorted', 'str', 'sum',
  'super', 'tuple', 'type', 'zip',
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'NameError', 'ZeroDivisionError',
];
const BASE_OPTIONS = [
  ...KEYWORDS.map((label) => ({ label, type: 'keyword' })),
  ...BUILTINS.map((label) => ({ label, type: /^[A-Z]/.test(label) ? 'class' : 'function' })),
];
const BASE_LABELS = new Set(BASE_OPTIONS.map((o) => o.label));
// 字符串与注释里不补全
const NOT_IN = ['String', 'FormatString', 'Comment'];

// 以当前词为前缀的候选只有一个且就是当前词本身：不弹（回车留给换行）
function onlySelf(options, word) {
  if (!word) return false;
  let hit = null;
  for (const o of options) {
    if (!o.label.startsWith(word)) continue;
    if (hit) return false;
    hit = o;
  }
  return !!hit && hit.label === word;
}

function currentWord(ctx) {
  const word = ctx.matchBefore(/\w+/);
  if (!ctx.explicit && (!word || word.from === word.to)) return undefined;   // undefined = 不补全
  return word;
}

// validFor 用函数：补全框弹出后继续打字时，CodeMirror 只在 validFor 为真时复用缓存候选、不再查源；
// 打成"唯一候选就是当前词"（pa → pass）时必须判为无效，让它重查源（返回 null 而关框），回车才会换行
function result(word, ctx, options, from) {
  if (options.length === 0 || onlySelf(options, word ? word.text : '')) return null;
  return {
    from: from ?? (word ? word.from : ctx.pos),
    options,
    validFor: (text) => /^\w*$/.test(text) && !onlySelf(options, text),
  };
}

const toOption = (x) => (typeof x === 'string' ? { label: x, type: 'variable' } : x);

// getExtra()：返回阶段传入的 extraCompletions（字符串或 CodeMirror Completion 对象）
// 两个源：① 关键词 + 内置函数；② 文档内标识符（localCompletionSource）+ extraCompletions，
// ② 内按名去重，且不重复 ① 已有的名字（import pandas as pd 后只出现一个 pd）
export function completionSources(getExtra = () => []) {
  const base = ifNotIn(NOT_IN, (ctx) => {
    const word = currentWord(ctx);
    if (word === undefined) return null;
    return result(word, ctx, BASE_OPTIONS);
  });
  const localAndExtra = ifNotIn(NOT_IN, (ctx) => {
    const word = currentWord(ctx);
    if (word === undefined) return null;
    const local = localCompletionSource(ctx);
    const extra = getExtra();
    const seen = new Set(BASE_LABELS);
    const options = [];
    for (const o of [...(local?.options ?? []), ...(Array.isArray(extra) ? extra.filter((x) => x != null).map(toOption) : [])]) {
      if (!o || typeof o.label !== 'string' || seen.has(o.label)) continue;
      seen.add(o.label);
      options.push(o);
    }
    return result(word, ctx, options, local?.from);
  });
  return [base, localAndExtra];
}

// ---------- 受控更新：整段 prev → next 化成一次最小区间替换 prev[start, end) → text ----------

export function diffRange(prev, next) {
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev[start] === next[start]) start++;
  let e1 = prev.length;
  let e2 = next.length;
  while (e1 > start && e2 > start && prev[e1 - 1] === next[e2 - 1]) {
    e1--;
    e2--;
  }
  return { start, end: e1, text: next.slice(start, e2) };
}

// ---------- 主题（浅色、平台令牌、固定） ----------

export const EDITOR_THEME = {
  '&': {
    flex: '1 1 0%',
    minHeight: '0',
    minWidth: '0',
    color: 'var(--ink)',
    backgroundColor: 'var(--surface)',
    fontSize: FONT,
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: MONO, lineHeight: '1.5', overflow: 'auto' },
  '.cm-content': { fontSize: FONT, padding: '8px 0', caretColor: 'var(--ink)' },
  '.cm-line': { padding: '0 8px' },
  '.cm-gutters': {
    fontSize: FONT,
    backgroundColor: 'var(--surface-alt)',
    color: 'var(--ink-dim)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 6px' },
  '.cm-activeLine': { backgroundColor: 'var(--brand-soft)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--brand-soft)', color: 'var(--ink-soft)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--good-soft)', outline: '1px solid var(--good)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--bad-soft)', outline: '1px solid var(--bad)' },
  '.cm-tooltip': {
    fontSize: FONT,
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-soft)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: MONO },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 8px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--brand)', color: 'var(--surface)' },
};
const theme = EditorView.theme(EDITOR_THEME, { dark: false });

// 外部（受控 value）写入的事务打这个标记：不回调 onChange
const External = Annotation.define();

const readOnlyExt = (ro) => [EditorState.readOnly.of(!!ro), EditorView.editable.of(!ro)];
const attrsExt = (label) => EditorView.contentAttributes.of({
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  'aria-label': label,
});
// 输入法组字期间（拼音选词，e.isComposing 为真）不让快捷键（Tab、Ctrl/Cmd+Enter 等 keymap）处理按键。
// 返回 true 时 CodeMirror 会对这次 keydown 调 preventDefault 并跳过后续处理器；组字文字经 composition / input 事件提交，
// 不靠 keydown 的默认行为（真机未验证）。单独的 keyCode 229（部分浏览器组字外也会报）不拦
const imeGuard = Prec.highest(EditorView.domEventHandlers({
  keydown: (e) => !!e.isComposing,
}));

// ---------- 组件 ----------

export default function Editor({ value = '', onChange, onRun, readOnly = false, ref, label = '代码', extraCompletions }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const cb = useRef({});
  cb.current = { onChange, onRun, extra: extraCompletions };
  const valueRef = useRef(value);
  valueRef.current = value;
  const roRef = useRef(readOnly);
  const labelRef = useRef(label);
  const [roComp] = useState(() => new Compartment());
  const [attrComp] = useState(() => new Compartment());

  useLayoutEffect(() => {
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: String(valueRef.current ?? ''),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          python(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          indentUnit.of('    '),
          EditorState.tabSize.of(4),
          autocompletion({ override: completionSources(() => cb.current.extra) }),
          Prec.highest(keymap.of([{
            key: 'Mod-Enter',
            run: () => {
              const fn = cb.current.onRun;
              if (typeof fn !== 'function') return false;
              fn();
              return true;
            },
          }])),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          imeGuard,
          attrComp.of(attrsExt(labelRef.current)),
          roComp.of(readOnlyExt(roRef.current)),
          theme,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (u.transactions.every((tr) => tr.annotation(External))) return;
            cb.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
    // 只在挂载时建一次；后续变化走下面的受控同步与 compartment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只读切换
  useEffect(() => {
    const view = viewRef.current;
    if (!view || roRef.current === readOnly) return;
    roRef.current = readOnly;
    view.dispatch({ effects: roComp.reconfigure(readOnlyExt(readOnly)) });
  }, [readOnly, roComp]);

  // 标签变化
  useEffect(() => {
    const view = viewRef.current;
    if (!view || labelRef.current === label) return;
    labelRef.current = label;
    view.dispatch({ effects: attrComp.reconfigure(attrsExt(label)) });
  }, [label, attrComp]);

  // 受控：value 与文档不同时替换（最小区间，光标尽量不跳）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = String(value ?? '');
    const cur = view.state.doc.toString();
    if (next === cur) return;
    const { start, end, text } = diffRange(cur, next);
    view.dispatch({
      changes: { from: start, to: end, insert: text },
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  useImperativeHandle(ref, () => ({
    indentMore: () => {
      const view = viewRef.current;
      return view ? indentMore(view) : false;
    },
    indentLess: () => {
      const view = viewRef.current;
      return view ? indentLess(view) : false;
    },
    focus: () => viewRef.current?.focus(),
  }), []);

  return (
    <div
      ref={hostRef}
      data-sandbox-editor=""
      style={{
        flex: '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    />
  );
}
