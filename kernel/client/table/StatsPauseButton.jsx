// 统计暂停按钮（v0.7：由教师外壳操作条渲染，控制内核统计暂停）：暂停态高亮并显示待更新条数
export default function StatsPauseButton({ paused, pendingCount, onToggle }) {
  return (
    <button
      type="button"
      data-testid="stats-pause"
      aria-pressed={!!paused}
      onClick={onToggle}
      style={{
        height: 'var(--control-h)',
        padding: '0 var(--sp-4)',
        fontSize: 'var(--fs-sm)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-strong)',
        background: paused ? 'var(--accent-soft)' : 'var(--surface)',
        color: paused ? 'var(--accent)' : 'var(--ink-soft)',
        cursor: 'pointer',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        flexShrink: 0,
      }}
    >
      {paused
        ? `▶ 恢复实时${pendingCount > 0 ? ` (${pendingCount} 条待更新)` : ''}`
        : '⏸ 暂停更新'}
    </button>
  );
}
