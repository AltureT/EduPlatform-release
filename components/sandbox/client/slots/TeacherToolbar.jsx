// teacherToolbar 槽位（规格 §3.7）：组件打开时恒显示芯片 "Python · 就绪 N / 在线 M"
// - 按教师端当前阶段计（useComponent().currentStage，不是正在查看的阶段）：prelogin 与无 sandbox 配置的阶段计 ready ∈ { core, stage }，
//   有配置的阶段只计 stage；数据来自 data.perStudent[name][currentStage.id]
// - 点击展开只读小面板（内核 Overlay 的 menu 形态，界面整理规格 §2.3；点遮罩关闭）：未就绪人数、出错人数、错误类型 Top 3（按 lastError 冒号前的异常类型聚合）
// - 教师在演示视图里放 <PyRunner> 时，其 Worker 的信箱 key 经 sandbox:t-stdin-key 登记（worker-created 与每次 stdin-request）
import { useEffect, useState } from 'react';
import { useComponent, useTeacherStage, Btn, Overlay } from '#kernel/client/index.js';
import { getPythonClient } from '../pythonClient.js';
import { useSandboxConfig } from '../stageConfig.js';

export function toolbarStats({ roster, perStudent, stageId, hasConfig }) {
  const online = (Array.isArray(roster) ? roster : []).filter((s) => s && s.connected === true);
  let ready = 0;
  let errored = 0;
  const types = new Map();
  for (const s of online) {
    const e = perStudent?.[s.name]?.[stageId];
    const ok = !!e && (hasConfig ? e.ready === 'stage' : e.ready === 'core' || e.ready === 'stage');
    if (ok) ready++;
    if (e?.lastError) {
      errored++;
      const type = String(e.lastError).split(':')[0].trim() || '?';
      types.set(type, (types.get(type) ?? 0) + 1);
    }
  }
  const top = [...types]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([type, n]) => ({ type, count: n }));
  return { online: online.length, ready, notReady: online.length - ready, errored, top };
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 'var(--fs-sm)', color: 'var(--ink)' }}>
      <span style={{ color: 'var(--ink-soft)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Toolbar({ c }) {
  const cur = c.currentStage.id;
  const { roster } = useTeacherStage(cur);
  const cfg = useSandboxConfig(cur);
  const hasConfig = !!(c.isEnabledFor(cur) && cfg);
  const stats = toolbarStats({ roster, perStudent: c.data.perStudent, stageId: cur, hasConfig });
  const [open, setOpen] = useState(false);
  const send = c.send;

  useEffect(() => getPythonClient().subscribe((ev) => {
    if (ev?.type !== 'worker-created' && ev?.type !== 'stdin-request') return;
    try {
      send('sandbox:t-stdin-key', { key: ev.key });
    } catch (e) {
      console.warn('[sandbox] t-stdin-key 发送失败', e);
    }
  }), [send]);

  return (
    <>
      <Btn size="sm" variant="soft" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {`Python · 就绪 ${stats.ready} / 在线 ${stats.online}`}
      </Btn>
      {open && (
        <Overlay variant="menu" label="Python 状态" testId="sandbox-toolbar-menu" onDismiss={() => setOpen(false)}>
          <div
            data-sandbox-panel=""
            style={{ alignSelf: 'flex-end', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}
          >
            <Row label="未就绪" value={stats.notReady} />
            <Row label="出错" value={stats.errored} />
            {stats.top.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                {stats.top.map((t) => <Row key={t.type} label={t.type} value={t.count} />)}
              </div>
            )}
          </div>
        </Overlay>
      )}
    </>
  );
}

export default function TeacherToolbar() {
  const c = useComponent('sandbox');
  if (c.role !== 'teacher') return null;
  return <Toolbar c={c} />;
}
