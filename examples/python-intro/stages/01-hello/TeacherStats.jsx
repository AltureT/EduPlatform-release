import { useState } from 'react';
import { useTeacherStage, DataTable, AlertBar, DetailModal } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';

const STAGE = 'hello';
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
const errorType = (error) => (error ? String(error).split(':')[0].trim() : null);

// 最近状态：草稿比提交新时看草稿（实时），否则看提交
const latestOf = (rec) => (rec?.draft && rec.draft.at > (rec.submittedAt ?? 0) ? rec.draft : rec);

const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name },
  { key: 'runs', label: '运行次数', accessor: (r) => r.runs ?? -1, render: (r) => r.runs ?? '—', align: 'right' },
  { key: 'error', label: '报错', accessor: (r) => r.error ?? '', render: (r) => r.error ?? '—' },
  { key: 'submittedAt', label: '提交时间', accessor: (r) => r.submittedAt ?? 0, render: (r) => fmtTime(r.submittedAt), align: 'right' },
];

const submittedPart = (rec) => (rec?.submittedAt != null ? rec : null);

const tabs = [
  {
    id: 'submitted',
    label: '提交',
    render: (s) => {
      const rec = submittedPart(s.stageData?.[STAGE]);
      return rec ? <PyOutput record={rec} label="已提交" /> : '—';
    },
  },
  {
    id: 'draft',
    label: '草稿',
    render: (s) => {
      const d = s.stageData?.[STAGE]?.draft;
      return d ? <PyOutput record={d} label="草稿" /> : '—';
    },
  },
];

export default function TeacherStats() {
  const { roster, perStudent, alerts } = useTeacherStage(STAGE);
  const [detail, setDetail] = useState(null);

  const rows = roster.map((s) => {
    const rec = perStudent[s.name];
    const latest = latestOf(rec);
    return {
      name: s.name,
      connected: s.connected,
      runs: latest?.runs ?? null,
      error: errorType(latest?.error),
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
