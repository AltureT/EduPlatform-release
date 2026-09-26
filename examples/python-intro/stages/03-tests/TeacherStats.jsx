import { useState } from 'react';
import { useTeacherStage, DataTable, AlertBar, DetailModal } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';

const STAGE = 'tests';
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name },
  { key: 'tests', label: '通过', accessor: (r) => r.passed ?? -1, render: (r) => (r.passed == null ? '—' : `${r.passed} / ${r.total}`), align: 'center' },
  { key: 'runs', label: '运行次数', accessor: (r) => r.runs ?? -1, render: (r) => r.runs ?? '—', align: 'right' },
  { key: 'submittedAt', label: '提交时间', accessor: (r) => r.submittedAt ?? 0, render: (r) => fmtTime(r.submittedAt), align: 'right' },
];

const tabs = [
  {
    id: 'submitted',
    label: '提交',
    render: (s) => {
      const rec = s.stageData?.[STAGE];
      return rec?.submittedAt != null ? <PyOutput record={rec} label="已提交" /> : '—';
    },
  },
];

export default function TeacherStats() {
  const { roster, perStudent, alerts } = useTeacherStage(STAGE);
  const [detail, setDetail] = useState(null);

  const rows = roster.map((s) => {
    const rec = perStudent[s.name];
    return {
      name: s.name,
      connected: s.connected,
      passed: rec?.tests?.passed ?? null,
      total: rec?.tests?.total ?? null,
      runs: rec?.runs ?? null,
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
