// <Tile title actions span fill>：磁贴（Card 的布局版）：标题行 + 可选右上角动作 + 内容 <Fill>
// fill（P3）：在纵向 flex 父级里撑满剩余高度（flex: 1 1 0%），内容区的 <Fill> 随之撑满；缺省按内容高
import Fill from './Fill.jsx';
import { pickProps, cx } from './props.js';

export default function Tile({ title, actions, span, fill = false, children, ...rest }) {
  const p = pickProps(rest, 'Tile');
  const n = Number(span);
  return (
    <section
      {...p}
      className={cx('ly-tile', p.className)}
      data-ly="tile"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-soft)',
        padding: 'var(--sp-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-3)',
        minWidth: 0,
        minHeight: 0,
        flex: fill ? '1 1 0%' : undefined,
        gridColumn: Number.isInteger(n) && n > 1 ? `span ${n}` : undefined,
      }}
    >
      {(title != null || actions != null) && (
        <div
          data-ly="tile-head"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', minWidth: 0 }}
        >
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          {actions != null && <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 }}>{actions}</div>}
        </div>
      )}
      <Fill>{children}</Fill>
    </section>
  );
}
