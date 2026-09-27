// code / data-analysis 共用的学生端"参考答案"面板（代码段教学功能规格 §2.3，P6）。只给原语作者用。
//
//   <SolutionPanel solution />
//   solution：班级记录里的 perClass.solution（教师点"公布参考答案给学生"后才有，撤回即清）；空 / 非字符串时不渲染。
//   Tile"参考答案"（data-testid="solution-tile"）：一行说明 + <CodeView size="sm">（高亮、不折行、横向滚动；U6）；
//   右上"放大"→ Overlay dialog fill 里同一段代码（可滚动、可选中复制）。不改编辑器、不提供"复制到编辑器"。
//
//   教师大屏（§2.4）：<PublishSolutionBtn publishedAt send />——未公布：ConfirmAdvanceBtn"公布参考答案给学生"（两次点击）
//   → teacher:publish-solution { on: true }；已公布：Btn soft"撤回参考答案"→ { on: false }；两者 data-testid="publish-solution"。
//   publishedHint(publishedAt) → 标题区提示后缀" · 参考答案已公布 HH:MM"（未公布为空串）。
import { useState } from 'react';
import { Btn, CodeView, ConfirmAdvanceBtn, Fill, Overlay, Row, Tile } from '#kernel/client/index.js';

const note = { color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)', lineHeight: 1.5, margin: '0 0 var(--sp-2)' };
export const SOLUTION_NOTE = '老师公布的参考答案，对照自己的代码看看哪里不一样';

export default function SolutionPanel({ solution }) {
  const [big, setBig] = useState(false);
  if (typeof solution !== 'string' || solution === '') return null;
  return (
    <Tile title="参考答案" data-testid="solution-tile" actions={<Btn size="sm" variant="soft" onClick={() => setBig(true)}>放大</Btn>}>
      <p style={note}>{SOLUTION_NOTE}</p>
      <CodeView code={solution} size="sm" data-testid="solution-code" />
      {big && (
        <Overlay variant="dialog" fill testId="solution-dialog" label="参考答案" onDismiss={() => setBig(false)}>
          <Row gap={3}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--ink)', flex: '1 1 auto', minWidth: 0 }}>参考答案</div>
            <Btn variant="ghost" onClick={() => setBig(false)}>关闭</Btn>
          </Row>
          <Fill scroll>
            <CodeView code={solution} size="md" />
          </Fill>
        </Overlay>
      )}
    </Tile>
  );
}

const fmtHM = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });

export function PublishSolutionBtn({ publishedAt, send }) {
  if (publishedAt != null) {
    return <Btn variant="soft" data-testid="publish-solution" onClick={() => send('teacher:publish-solution', { on: false })}>撤回参考答案</Btn>;
  }
  return (
    <ConfirmAdvanceBtn variant="soft" data-testid="publish-solution" onAdvance={() => send('teacher:publish-solution', { on: true })}>
      公布参考答案给学生
    </ConfirmAdvanceBtn>
  );
}
export const publishedHint = (publishedAt) => (publishedAt != null ? ` · 参考答案已公布 ${fmtHM(publishedAt)}` : '');
