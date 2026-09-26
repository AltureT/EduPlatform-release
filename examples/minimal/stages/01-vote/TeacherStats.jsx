import { useState } from 'react';
import { useTeacherStage, DataTable, AlertBar, DetailModal } from '#kernel/client/index.js';

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name, sortable: true },
  { key: 'submitted', label: '是否提交', accessor: (r) => (r.submitted ? 1 : 0), render: (r) => (r.submitted ? '是' : '否'), align: 'center', sortable: true },
  { key: 'choice', label: '选项', accessor: (r) => r.choice ?? '', render: (r) => r.choice ?? '—', align: 'center', sortable: true },
  { key: 'submittedAt', label: '提交时间', accessor: (r) => r.submittedAt ?? 0, render: (r) => fmtTime(r.submittedAt), align: 'right', sortable: true },
];

const pre = (value) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>;

const tabs = [
  { id: 'record', label: '记录', render: (s) => pre(s.stageData?.['vote'] ?? null) },
  { id: 'events', label: '事件', render: (s) => pre(s.events ?? []) },
];

// 统计视图只提供提醒、列与详情：外壳套 table 模板（内容直接进 Page.Main，表格在其中内部滚动），
// 推进与暂停更新在外壳操作条（契约 v0.7）
export default function TeacherStats() {
  const { roster, perStudent, alerts } = useTeacherStage('vote');
  const [detail, setDetail] = useState(null);

  const rows = roster.map((s) => {
    const rec = perStudent[s.name];
    return {
      name: s.name,
      connected: s.connected,
      submitted: rec?.choice != null,
      choice: rec?.choice ?? null,
      submittedAt: rec?.submittedAt ?? null,
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
