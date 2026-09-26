import { useState } from 'react';
import { useTeacherStage, AlertBar, DataTable, DetailModal, Chip, Row } from '#kernel/client/index.js';

const verifyText = (r) => (r.passed === true ? '通过' : r.passed === false ? '未通过' : '未验证');
const verifyRank = (r) => (r.passed === true ? 2 : r.passed === false ? 1 : 0);

// D 栏：姓名、第一步完成、第二步验证；顶部验证通过人数
const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name, sortable: true },
  { key: 'step1', label: '第一步完成', accessor: (r) => (r.step1At ? 1 : 0), render: (r) => (r.step1At ? '✓' : '—'), align: 'center', sortable: true },
  { key: 'verify', label: '第二步验证', accessor: verifyRank, render: verifyText, align: 'center', sortable: true },
];

const pre = (value) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>;
const tabs = [{ id: 'record', label: '记录', render: (s) => pre(s.stageData?.['model'] ?? null) }];

export default function TeacherStats() {
  const { roster, perStudent, alerts } = useTeacherStage('model');
  const [detail, setDetail] = useState(null);
  const rows = roster.map((s) => ({ name: s.name, connected: s.connected, ...(perStudent[s.name] ?? {}) }));
  const connected = roster.filter((s) => s.connected);
  const passed = connected.filter((s) => perStudent[s.name]?.passed === true).length;
  return (
    <>
      <AlertBar alerts={alerts} />
      <Row gap={2}>
        <Chip tone="brand">验证通过 {passed}/{connected.length}</Chip>
      </Row>
      <DataTable columns={columns} rows={rows} rowKey="name" offlineKey="connected" defaultSort={{ key: 'name', dir: 'asc' }} onRowClick={(r) => setDetail(r.name)} />
      {detail && <DetailModal name={detail} tabs={tabs} onClose={() => setDetail(null)} />}
    </>
  );
}
