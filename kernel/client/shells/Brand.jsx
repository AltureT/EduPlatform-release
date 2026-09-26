// 品牌块：一字标识 + 课名（来自 classroom:state.lesson）
export default function Brand({ glyph, title, size = 'md' }) {
  const box = size === 'lg' ? 48 : size === 'sm' ? 24 : 36;
  const glyphFont = size === 'lg' ? 22 : size === 'sm' ? 13 : 18;
  const titleFont = size === 'lg' ? 'var(--heading, 1.5rem)' : size === 'sm' ? 'var(--fs-sm)' : 'var(--fs-xl)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size === 'sm' ? 10 : 14, minWidth: 0 }}>
      {glyph ? (
        <div style={{
          width: box, height: box, borderRadius: Math.round(box / 4), background: 'var(--brand)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          color: 'var(--surface)', fontSize: glyphFont, fontWeight: 700,
        }}>{glyph}</div>
      ) : null}
      {title ? (
        <div style={{ fontSize: titleFont, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      ) : null}
    </div>
  );
}
