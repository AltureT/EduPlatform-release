// 规格 §9.3：BarDistribution({ items:[{ label, value, color? }], max?, horizontal? })
// max 缺省取 items 最大值；horizontal 为 true 时横向条形，否则纵向柱形
export default function BarDistribution({ items = [], max, horizontal = false }) {
  const list = Array.isArray(items) ? items : [];
  const top = Number.isFinite(max) && max > 0
    ? max
    : Math.max(0, ...list.map((it) => (Number.isFinite(it.value) ? it.value : 0)));
  const pctOf = (v) => {
    if (!(top > 0) || !Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, (v / top) * 100));
  };

  if (horizontal) {
    return (
      <div data-testid="bar-distribution" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((it, i) => (
          <div key={`${it.label}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(4em, max-content) 1fr minmax(2.5em, max-content)', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm, 0.875rem)' }}>{it.label}</span>
            <div style={{ height: 'clamp(10px, 1vw, 16px)', background: 'var(--surface-alt)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                data-testid="bar-fill"
                style={{
                  width: `${pctOf(it.value)}%`,
                  height: '100%',
                  background: it.color || 'var(--brand)',
                  borderRadius: 999,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span style={{ fontFamily: 'ui-monospace, monospace', textAlign: 'right', color: 'var(--ink)' }}>{it.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="bar-distribution" style={{ display: 'flex', alignItems: 'stretch', gap: 12, minHeight: 160 }}>
      {list.map((it, i) => (
        <div key={`${it.label}-${i}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--ink)' }}>{it.value}</span>
          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', minHeight: 100 }}>
            <div
              data-testid="bar-fill"
              style={{
                width: '100%',
                height: `${pctOf(it.value)}%`,
                background: it.color || 'var(--brand)',
                transition: 'height 0.3s ease',
              }}
            />
          </div>
          <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm, 0.875rem)', textAlign: 'center', overflowWrap: 'anywhere' }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
