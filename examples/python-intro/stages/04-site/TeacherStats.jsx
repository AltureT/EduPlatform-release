import { useState } from 'react';
import { useTeacherStage, DataTable, AlertBar, DetailModal } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';

const STAGE = 'site';
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
const errorType = (error) => (error ? String(error).split(':')[0].trim() : null);
// 已提交但 homeStatus 为 null：提交时模拟浏览器还没在新代码下打开过首页 →"未检查"；未提交 →"—"
const homeText = (r) => (r?.submittedAt == null ? '—' : r.homeStatus ?? '未检查');

const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name },
  { key: 'homeStatus', label: '首页状态码', accessor: (r) => r.homeStatus ?? -1, render: (r) => homeText(r), align: 'center' },
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
      return rec?.submittedAt != null ? <PyOutput record={rec} label={`已提交 · 首页 ${homeText(rec)}`} /> : '—';
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
      homeStatus: submitted ? rec.homeStatus ?? null : null,
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
