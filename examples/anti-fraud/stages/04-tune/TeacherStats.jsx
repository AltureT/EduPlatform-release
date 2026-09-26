import { useState } from 'react';
import { useTeacherStage, AlertBar, DataTable, DetailModal } from '#kernel/client/index.js';

const pct = (x) => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '—');
const num = (x) => (typeof x === 'number' ? x : -1);

// D 栏：姓名、检验次数、查全、查准、F1、预测填写率、累计猜中
const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name, sortable: true },
  { key: 'tests', label: '检验次数', accessor: (r) => r.tests ?? 0, align: 'right', sortable: true },
  { key: 'recall', label: '查全', accessor: (r) => num(r.last?.recall), render: (r) => pct(r.last?.recall), align: 'right', sortable: true },
  { key: 'precision', label: '查准', accessor: (r) => num(r.last?.precision), render: (r) => pct(r.last?.precision), align: 'right', sortable: true },
  { key: 'f1', label: 'F1', accessor: (r) => num(r.last?.f1), render: (r) => r.last?.f1 ?? '—', align: 'right', sortable: true },
  {
    key: 'predictRate',
    label: '预测填写率',
    // 第一次检验不用填预测，分母不算它
    accessor: (r) => ((r.tests ?? 0) > 1 ? (r.predicted ?? 0) / (r.tests - 1) : -1),
    render: (r) => ((r.tests ?? 0) > 1 ? pct(Math.min(1, (r.predicted ?? 0) / (r.tests - 1))) : '—'),
    align: 'right',
    sortable: true,
  },
  { key: 'hitsTotal', label: '累计猜中', accessor: (r) => r.hitsTotal ?? 0, align: 'right', sortable: true },
];

const pre = (value) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>;
const tabs = [{ id: 'record', label: '记录', render: (s) => pre(s.stageData?.['tune'] ?? null) }];

export default function TeacherStats() {
  const { roster, perStudent, alerts } = useTeacherStage('tune');
  const [detail, setDetail] = useState(null);
  const rows = roster.map((s) => ({ name: s.name, connected: s.connected, ...(perStudent[s.name] ?? {}) }));
  return (
    <>
      <AlertBar alerts={alerts} />
      <DataTable columns={columns} rows={rows} rowKey="name" offlineKey="connected" defaultSort={{ key: 'name', dir: 'asc' }} onRowClick={(r) => setDetail(r.name)} />
      {detail && <DetailModal name={detail} tabs={tabs} onClose={() => setDetail(null)} />}
    </>
  );
}
