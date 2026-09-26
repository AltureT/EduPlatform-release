// 可排序表头：点击触发 onSort(sortKey)，当前列显示 ↑/↓；v0.7 高 --control-h-sm（表格内按钮）
export default function SortHeader({
  label, sortKey, currentKey, currentDir, onSort,
  align = 'left', style: extraStyle,
}) {
  const active = currentKey === sortKey;
  const arrow = active ? (currentDir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        height: 'var(--control-h-sm)',
        cursor: 'pointer',
        font: 'inherit',
        color: active ? 'var(--accent)' : 'var(--ink-dim)',
        fontWeight: active ? 700 : 600,
        textAlign: align,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        whiteSpace: 'nowrap',
        ...extraStyle,
      }}
    >
      <span>{label}</span>
      {arrow && <span style={{ fontSize: '0.85em' }}>{arrow}</span>}
    </button>
  );
}
