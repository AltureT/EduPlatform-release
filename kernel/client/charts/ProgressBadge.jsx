// 进度徽章：complete → ✓ total/total；running 或 total>0 → 进度条 + done/total；否则不渲染
export default function ProgressBadge({ done = 0, total = 0, pct, running, complete }) {
  if (complete) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm, 0.875rem)', color: 'var(--good)' }}>
        <span style={{ fontWeight: 600 }}>✓</span>
        <span style={{ color: 'var(--ink-dim)', fontFamily: 'ui-monospace, monospace' }}>{total}/{total}</span>
      </div>
    );
  }
  if (!running && !(total > 0)) return null;
  const p = Number.isFinite(pct) ? pct : (total > 0 ? (done / total) * 100 : 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 'clamp(200px, 24vw, 320px)' }}>
      <div style={{
        flex: 1, height: 'clamp(8px, 0.9vw, 12px)',
        background: 'var(--surface-alt)',
        borderRadius: 999,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, p))}%`, height: '100%',
          background: 'var(--brand)',
          transition: 'width 200ms ease-out',
        }} />
      </div>
      <span style={{
        fontSize: 'var(--fs-xs, 0.75rem)', color: 'var(--ink-soft)',
        fontFamily: 'ui-monospace, monospace', minWidth: 'clamp(52px, 5.5vw, 68px)',
        textAlign: 'right',
      }}>
        {done}/{total}
      </span>
    </div>
  );
}
