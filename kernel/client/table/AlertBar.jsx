// 规格 §9.3：AlertBar({ alerts })，alerts = [{ id, text, names: [] }]；为空不渲染
import Chip from '../ui/Chip.jsx';

export default function AlertBar({ alerts }) {
  const list = Array.isArray(alerts) ? alerts.filter((a) => a && Array.isArray(a.names) && a.names.length > 0) : [];
  if (list.length === 0) return null;
  return (
    <div
      data-testid="alert-bar"
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 12px',
        background: 'var(--warn-soft)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {list.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 'var(--fs-sm, 0.875rem)' }}>
          <span style={{ fontWeight: 600, color: 'var(--warn)' }}>{a.text}</span>
          <Chip tone="warn">{a.names.length}</Chip>
          <span style={{ color: 'var(--ink-soft)' }}>{a.names.join('、')}</span>
        </div>
      ))}
    </div>
  );
}
