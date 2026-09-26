// 教师端 演示 / 统计 切换（外壳内部件，不经公开入口导出；v0.7 放在操作条，short 时用短文案）
const items = [
  { id: 'demo',  label: '演示视图', short: '演示' },
  { id: 'stats', label: '统计视图', short: '统计' },
];

export default function ViewToggle({ value, onChange, disabled = false, short = false }) {
  return (
    <div style={{
      display: 'inline-flex',
      flexShrink: 0,
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-strong)',
      overflow: 'hidden',
      opacity: disabled ? 0.5 : 1,
    }}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            aria-pressed={on}
            onClick={() => !disabled && onChange && onChange(it.id)}
            disabled={disabled}
            style={{
              height: 'var(--control-h)',
              padding: '0 var(--sp-4)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: on ? 'var(--brand)' : 'transparent',
              color: on ? 'var(--surface)' : 'var(--ink-soft)',
              border: 'none',
              transition: 'all 0.15s',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {short ? it.short : it.label}
          </button>
        );
      })}
    </div>
  );
}
