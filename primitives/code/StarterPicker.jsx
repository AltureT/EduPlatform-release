// code 学生视图的"选一个起点"（代码段教学功能规格 §4.2，P6）：options.starters 有 ≥ 2 份、本段没有草稿也没选过时，
// Page.Main 不放 PyRunner、放这里。每份一张 Card：标题 label，正文该份代码前 8 行（<CodeView maxLines={8}>，高亮，多出的行显示"…还有 N 行"；
// 空代码显示"从空白开始"），底部"用这份"。
// 宽屏按可用宽度排成几列（Tiles，每列至少 220 px），窄屏单列；内容多时在 Main 里纵向滚动。
import { Btn, Card, CodeView, Fill, Tile, Tiles } from '#kernel/client/index.js';

export const PREVIEW_LINES = 8;
const cardStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', minWidth: 0 };

export default function StarterPicker({ starters, onPick }) {
  return (
    <Fill scroll>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <Tile title="选一个起点" data-testid="starter-picker">
          <p style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>
            老师准备了几份起始代码，挑一份开始写；之后可以点"换起点"重新选。
          </p>
          <Tiles min="220px" gap={3}>
            {starters.map((s) => (
              <Card key={s.label} pad="var(--sp-4)" data-starter={s.label} style={cardStyle}>
                <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--ink)' }}>{s.label}</div>
                {String(s.code ?? '').trim() === ''
                  ? <div style={{ color: 'var(--ink-dim)', lineHeight: 1.5 }}>从空白开始</div>
                  : <div><CodeView code={String(s.code)} size="sm" maxLines={PREVIEW_LINES} /></div>}
                <div style={{ marginTop: 'auto' }}>
                  <Btn variant="accent" onClick={() => onPick(s.label)}>用这份</Btn>
                </div>
              </Card>
            ))}
          </Tiles>
        </Tile>
      </div>
    </Fill>
  );
}
