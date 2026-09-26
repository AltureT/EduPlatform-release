export default function Bar({ value, max = 1, color, height = 8, bg }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (Number(value) / max) * 100)) : 0;
  return (
    <div style={{
      width: '100%',
      height,
      background: bg || 'var(--surface-alt)',
      borderRadius: 999,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${Number.isFinite(pct) ? pct : 0}%`,
        height: '100%',
        background: color || 'var(--brand)',
        borderRadius: 999,
        transition: 'width 0.3s ease',
      }} />
    </div>
  );
}
