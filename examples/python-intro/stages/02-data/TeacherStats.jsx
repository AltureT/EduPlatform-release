import { useState } from 'react';
import { useTeacherStage, DataTable, AlertBar, DetailModal } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';

const STAGE = 'data';
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
const errorType = (error) => (error ? String(error).split(':')[0].trim() : null);

const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name },
  { key: 'image', label: '出图', accessor: (r) => (r.image == null ? -1 : r.image ? 1 : 0), render: (r) => (r.image == null ? '—' : r.image ? '是' : '否'), align: 'center' },
  { key: 'runs', label: '运行次数', accessor: (r) => r.runs ?? -1, render: (r) => r.runs ?? '—', align: 'right' },
  { key: 'error', label: '报错', accessor: (r) => r.error ?? '', render: (r) => r.error ?? '—' },
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
    const submitted = rec?.submittedAt != null;
    return {
      name: s.name,
      connected: s.connected,
      image: submitted ? Array.isArray(rec.images) && rec.images.length > 0 : null,
      runs: submitted ? rec.runs : null,
      error: submitted ? errorType(rec.error) : null,
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
