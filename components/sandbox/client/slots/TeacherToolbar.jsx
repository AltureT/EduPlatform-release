// teacherToolbar 槽位（规格 §3.7）：T9a（教师视图与学生页重排规格 §2.1）起渲染 null——"Python · 就绪 N / 在线 M"不再是操作条上的芯片，
//   改到课前页一行（teacherPrelogin 槽位）与 code / data-analysis 统计视图的摘要芯片（usePythonReady，./pythonReady.js）。
//   槽位仍常驻挂载：教师在演示视图里放 <PyRunner> 时，其 Worker 的信箱 key 经 sandbox:t-stdin-key 登记（worker-created 与每次 stdin-request）
// - toolbarStats：按阶段计在线学生的就绪 / 出错（prelogin 与无 sandbox 配置的阶段计 ready ∈ { core, stage }，有配置的阶段只计 stage；
//   错误类型 Top 3 按 lastError 冒号前的异常类型聚合）
import { useEffect } from 'react';
import { useComponent } from '#kernel/client/index.js';
import { getPythonClient } from '../pythonClient.js';

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

function Toolbar({ c }) {
  const send = c.send;
  useEffect(() => getPythonClient().subscribe((ev) => {
    if (ev?.type !== 'worker-created' && ev?.type !== 'stdin-request') return;
    try {
      send('sandbox:t-stdin-key', { key: ev.key });
    } catch (e) {
      console.warn('[sandbox] t-stdin-key 发送失败', e);
    }
  }), [send]);
  return null;
}

export default function TeacherToolbar() {
  const c = useComponent('sandbox');
  if (c.role !== 'teacher') return null;
  return <Toolbar c={c} />;
}
