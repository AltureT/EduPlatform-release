// 原语的正文槽（P4）：vote / quiz / free-text 的 options.prompt——题目之外的材料（短信原文、情境、阅读段落）。
// 纯文本；空行分段，段内换行原样保留（pre-wrap）。原语视图把它放在 Page.Main 的最前面（标题下方、内容之前）；
// 没有内容时不渲染。内核没有公开的"正文"组件，这里用 <p> + 主题字号令牌，写法与 code / data-analysis 的题目面板一致。
export function paragraphs(text) {
  return String(text ?? '').split(/\n\s*\n/).map((p) => p.replace(/^\s*\n|\n\s*$/g, '').trimEnd()).filter((p) => p.trim() !== '');
}

// 最多约 18em（十来行），超出在正文内滚动，不把下面的图表 / 文本框挤没（P4 审查建议）
const boxStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', flexShrink: 0, maxHeight: '18em', overflow: 'auto' };

// size：学生页用 md（比标题小一号），大屏用 lg
export default function PromptText({ text, size = 'md' }) {
  const list = paragraphs(text);
  if (list.length === 0) return null;
  const pStyle = { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, fontSize: `var(--fs-${size})`, color: 'var(--ink)' };
  return (
    <div data-testid="primitive-prompt" style={boxStyle}>
      {list.map((p, i) => <p key={i} style={pStyle}>{p}</p>)}
    </div>
  );
}
