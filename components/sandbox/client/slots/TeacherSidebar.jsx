// teacherSidebar 槽位（规格 §3.7）：所查看阶段有 sandbox 配置时，列出在线学生里的"未就绪"（ready ≠ stage）与"最近出错"（有 lastError）；否则不渲染
import { useComponent, useTeacherStage, Card } from '#kernel/client/index.js';
import { useSandboxConfig } from '../stageConfig.js';

function List({ id, title, items }) {
  return (
    <div data-sandbox-list={id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{`${title} ${items.length}`}</div>
      {items.length === 0 && <div style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>—</div>}
      {items.map((it) => (
        <div key={it.name} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--fs-sm)' }}>
          <span style={{ color: 'var(--ink)' }}>{it.name}</span>
          {it.detail && <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-xs)' }}>{it.detail}</span>}
        </div>
      ))}
    </div>
  );
}

function Sidebar({ c, stageId }) {
  const { roster } = useTeacherStage(stageId);
  const cfg = useSandboxConfig(stageId);
  if (!(c.isEnabledFor(stageId) && cfg)) return null;
  const per = c.data.perStudent;
  const online = (Array.isArray(roster) ? roster : []).filter((s) => s && s.connected === true);
  const notReady = [];
  const errored = [];
  for (const s of online) {
    const e = per?.[s.name]?.[stageId];
    if (e?.ready !== 'stage') notReady.push({ name: s.name });
    if (e?.lastError) errored.push({ name: s.name, detail: String(e.lastError).split(':')[0].trim() });
  }
  return (
    <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <List id="not-ready" title="未就绪" items={notReady} />
      <List id="errored" title="最近出错" items={errored} />
    </Card>
  );
}

export default function TeacherSidebar({ stageId }) {
  const c = useComponent('sandbox');
  if (c.role !== 'teacher') return null;
  return <Sidebar c={c} stageId={stageId} />;
}
