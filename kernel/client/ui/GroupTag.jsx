// 分组小标签：色点 + 名称。字号用 em 跟随父级。
// size: 'sm'（默认 0.78em）| 'md'（0.88em）| 'lg'（inherit）；无 label 渲染 null
export default function GroupTag({ label, color = 'var(--ink-soft)', size = 'sm', style }) {
  if (label == null || label === '') return null;
  const dotSize = size === 'lg' ? 8 : 6;
  const fontSize = size === 'lg' ? 'inherit' : size === 'md' ? '0.88em' : '0.78em';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize,
      color,
      fontWeight: 500,
      whiteSpace: 'nowrap',
      ...style,
    }}>
      <span aria-hidden="true" style={{
        width: dotSize, height: dotSize, borderRadius: dotSize,
        background: color, flexShrink: 0, display: 'inline-block',
      }} />
      {label}
    </span>
  );
}
