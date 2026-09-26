// 原语统一的教师统计视图骨架（活动原语规格 §2.6）。只给原语作者用，不对阶段公开。
//
//   <StatsPage stageId columns summary rowDetail />
//   columns:   [{ key, label, render?(record, student), value?(record, student), align? }]
//              "姓名"列由骨架自动放在最前；value 用于排序（缺省取 record[key]）；record 可能为 undefined（未作答）
//   summary:   (records, students) → [{ label, value }]，records = { [name]: record }，students = roster；渲染为顶部一行芯片
//   rowDetail: (record, student) → ReactNode；点行打开 DetailModal，"记录"页签渲染它，"事件"页签列出该生事件
//
// 外壳已为统计视图套 table 模板（契约 §四：TeacherStats 不是 <Page>），这里只提供摘要芯片、AlertBar、DataTable、DetailModal。
// 只用 #kernel/client/index.js 的公开导出。
import { useState } from 'react';
import { useTeacherStage, DataTable, AlertBar, DetailModal, Chip, Row } from '#kernel/client/index.js';

const pre = (value) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--fs-sm)' }}>{JSON.stringify(value, null, 2)}</pre>;

export default function StatsPage({ stageId, columns = [], summary, rowDetail }) {
  const { roster, perStudent, alerts } = useTeacherStage(stageId);
  const [detail, setDetail] = useState(null);

  const rows = roster.map((s) => ({ name: s.name, connected: s.connected, student: s, record: perStudent[s.name] }));
  const tableColumns = [
    { key: 'name', label: '姓名', accessor: (r) => r.name },
    ...columns.map((c) => ({
      key: c.key,
      label: c.label,
      align: c.align,
      accessor: (r) => {
        const v = typeof c.value === 'function' ? c.value(r.record, r.student) : r.record?.[c.key];
        return v ?? '';
      },
      render: typeof c.render === 'function' ? (r) => c.render(r.record, r.student) : undefined,
    })),
  ];
  const chips = typeof summary === 'function' ? summary(perStudent, roster) || [] : [];
  const detailStudent = detail ? roster.find((s) => s.name === detail) ?? { name: detail } : null;

  const tabs = [
    {
      id: 'record',
      label: '记录',
      render: (snap) => {
        const record = snap?.stageData?.[stageId] ?? perStudent[detail];
        if (typeof rowDetail === 'function') return rowDetail(record, detailStudent);
        return pre(record ?? null);
      },
    },
    { id: 'events', label: '事件', render: (snap) => pre(snap?.events ?? []) },
  ];

  return (
    <>
      {chips.length > 0 && (
        <Row gap={2} data-testid="stats-summary">
          {chips.map((c) => (
            <Chip key={c.label} tone="brand">{c.label} {c.value}</Chip>
          ))}
        </Row>
      )}
      <AlertBar alerts={alerts} />
      <DataTable
        columns={tableColumns}
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
