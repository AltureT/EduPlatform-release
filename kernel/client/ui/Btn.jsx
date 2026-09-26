// 界面整理规格 §4：md 高 var(--control-h)（触屏 44），sm 高 var(--control-h-sm)（只用于顶栏与表格内），lg 48
const sizes = {
  lg: { height: 48, fontSize: 'var(--fs-md)', padding: '0 1.5rem' },
  md: { height: 'var(--control-h)', fontSize: 'var(--fs-sm)', padding: '0 1.125rem' },
  sm: { height: 'var(--control-h-sm)', fontSize: 'var(--fs-xs)', padding: '0 0.875rem' },
};

const variants = {
  primary: { bg: 'var(--brand)', fg: 'var(--surface)', bd: 'var(--brand)' },
  accent:  { bg: 'var(--accent)', fg: 'var(--surface)', bd: 'var(--accent)' },
  danger:  { bg: 'var(--bad)', fg: 'var(--surface)', bd: 'var(--bad)' },
  ghost:   { bg: 'transparent', fg: 'var(--ink)', bd: 'var(--border-strong)' },
  soft:    { bg: 'var(--surface-alt)', fg: 'var(--ink)', bd: 'transparent' },
};

export default function Btn({ children, variant = 'primary', size = 'md', disabled, style, type = 'button', ...rest }) {
  const sz = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;
  return (
    <button
      type={type}
      disabled={disabled}
      {...rest}
      style={{
        height: sz.height,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        padding: sz.padding,
        fontSize: sz.fontSize,
        fontWeight: 500,
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.bd}`,
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        letterSpacing: '0.01em',
        fontFamily: 'inherit',
        opacity: disabled ? 0.45 : 1,
        transition: 'opacity 0.2s',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
