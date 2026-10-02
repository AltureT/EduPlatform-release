const toneMap = {
  default: { bg: 'var(--surface-alt)', fg: 'var(--ink-soft)', bd: 'transparent' },
  brand:   { bg: 'var(--brand-soft)', fg: 'var(--brand)', bd: 'transparent' },
  accent:  { bg: 'var(--accent-soft)', fg: 'var(--accent)', bd: 'transparent' },
  good:    { bg: 'var(--good-soft)', fg: 'var(--good)', bd: 'transparent' },
  warn:    { bg: 'var(--warn-soft)', fg: 'var(--warn)', bd: 'transparent' },
  bad:     { bg: 'var(--bad-soft)', fg: 'var(--bad)', bd: 'transparent' },
  neutral: { bg: 'var(--surface-alt)', fg: 'var(--ink-soft)', bd: 'transparent' },
  outline: { bg: 'transparent', fg: 'var(--ink-soft)', bd: 'var(--border-strong)' },
};

export default function Chip({ children, tone = 'default', style, ...rest }) {
  const t = toneMap[tone] || toneMap.default;
  return (
    <span {...rest} style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 28,
      padding: '0 10px',
      borderRadius: 999,
      background: t.bg,
      color: t.fg,
      border: `1px solid ${t.bd}`,
      fontSize: 'var(--fs-xs)',
      fontWeight: 500,
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {children}
    </span>
  );
}
