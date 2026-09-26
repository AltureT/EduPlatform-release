import { useState } from 'react';
import { useTeacherStage, AlertBar, DataTable, DetailModal } from '#kernel/client/index.js';

const pct = (x) => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '—');
const num = (x) => (typeof x === 'number' ? x : -1);

// D 栏：姓名、查全、查准、F1、误拦数；按 F1 排行（名次列 + 默认按 F1 降序）
const columns = [
  { key: 'rank', label: '名次', accessor: (r) => r.rank ?? 999, render: (r) => r.rank ?? '—', align: 'right', sortable: true },
  { key: 'name', label: '姓名', accessor: (r) => r.name, sortable: true },
  { key: 'recall', label: '查全', accessor: (r) => num(r.recall), render: (r) => pct(r.recall), align: 'right', sortable: true },
  { key: 'precision', label: '查准', accessor: (r) => num(r.precision), render: (r) => pct(r.precision), align: 'right', sortable: true },
  { key: 'f1', label: 'F1', accessor: (r) => num(r.f1), render: (r) => r.f1 ?? '—', align: 'right', sortable: true },
  { key: 'blocked', label: '误拦数', accessor: (r) => num(r.blocked), render: (r) => r.blocked ?? '—', align: 'right', sortable: true },
];

const pre = (value) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>;
const tabs = [{ id: 'record', label: '记录', render: (s) => pre(s.stageData?.['intercept'] ?? null) }];

export default function TeacherStats() {
  const { roster, perStudent, alerts } = useTeacherStage('intercept');
  const [detail, setDetail] = useState(null);
  const ranked = Object.entries(perStudent)
    .filter(([, r]) => typeof r?.f1 === 'number')
    .sort((a, b) => b[1].f1 - a[1].f1);
  const rankOf = new Map(ranked.map(([name], i) => [name, i + 1]));
  const rows = roster.map((s) => ({ name: s.name, connected: s.connected, rank: rankOf.get(s.name), ...(perStudent[s.name] ?? {}) }));
  return (
    <>
      <AlertBar alerts={alerts} />
      <DataTable columns={columns} rows={rows} rowKey="name" offlineKey="connected" defaultSort={{ key: 'f1', dir: 'desc' }} onRowClick={(r) => setDetail(r.name)} />
      {detail && <DetailModal name={detail} tabs={tabs} onClose={() => setDetail(null)} />}
    </>
  );
}
