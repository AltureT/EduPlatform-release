import { useState } from 'react';
import { useTeacherStage, DataTable, AlertBar, DetailModal } from '#kernel/client/index.js';

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name, sortable: true },
  { key: 'length', label: '字数', accessor: (r) => r.length ?? -1, render: (r) => r.length ?? '—', align: 'right', sortable: true },
  { key: 'updatedAt', label: '最后更新', accessor: (r) => r.updatedAt ?? 0, render: (r) => fmtTime(r.updatedAt), align: 'right', sortable: true },
];

const pre = (value) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>;

const tabs = [
  { id: 'record', label: '记录', render: (s) => pre(s.stageData?.['freeform'] ?? null) },
  { id: 'events', label: '事件', render: (s) => pre(s.events ?? []) },
];

// 统计视图只提供提醒、列与详情：外壳套 table 模板（内容直接进 Page.Main，表格在其中内部滚动），
// 推进与暂停更新在外壳操作条（契约 v0.7）
export default function TeacherStats() {
  const { roster, perStudent, alerts } = useTeacherStage('freeform');
  const [detail, setDetail] = useState(null);

  const rows = roster.map((s) => {
    const rec = perStudent[s.name];
    return {
      name: s.name,
      connected: s.connected,
      length: rec?.length ?? null,
      updatedAt: rec?.updatedAt ?? null,
    };
  });

  return (
    <>
      <AlertBar alerts={alerts} />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey="name"
        offlineKey="connected"
        defaultSort={{ key: 'name', dir: 'asc' }}
        onRowClick={(r) => setDetail(r.name)}
      />
      {detail && <DetailModal name={detail} tabs={tabs} onClose={() => setDetail(null)} />}
    </>
  );
}
