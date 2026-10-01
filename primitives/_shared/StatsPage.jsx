// 原语统一的教师统计视图骨架（活动原语规格 §2.6）。只给原语作者用，不对阶段公开。
//
//   <StatsPage stageId columns summary rowDetail summaryBlock />
//   columns:   [{ key, label, render?(record, student), value?(record, student), align? }]
//              "姓名"列由骨架自动放在最前；value 用于排序（缺省取 record[key]）；record 可能为 undefined（未作答）
//   summary:   (records, students) → [{ label, value }]，records = { [name]: record }，students = roster；渲染为顶部一行芯片
//   rowDetail: (record, student, { fromSnapshot }) → ReactNode；点行打开 DetailModal，"记录"页签渲染它，"事件"页签列出该生事件；
//              K10：fromSnapshot 为真表示 record 来自 teacher:student-detail 拉到的完整记录，假表示退回了教师端推送来的记录
//
//   summaryBlock（T9a，教师视图与学生页重排规格 §2.3）：统计视图的摘要区——ReactNode 或 (ctx) => ReactNode，
//              ctx = { roster, perStudent, perClass, options, send }；原语把原演示视图主体（正确率条、柱状、投屏作品……）放这里
//
// 外壳已为统计视图 / 明细表套 table 模板（契约 §四：TeacherStats 不是 <Page>），这里只提供摘要芯片、AlertBar、摘要区、DataTable、DetailModal。
// T9a：按 useTeacherStage().view 分两种——
//   'stats'（统计视图）：摘要芯片 → AlertBar → summaryBlock；没给 summaryBlock 时芯片与提醒之下照旧放学生表（兼容）
//   'table'（明细表）：AlertBar → 学生表（列、排序、行详情、投到大屏不变），不放芯片与摘要区
//   其它（不在教师外壳里，如单测、旧式渲染）：芯片 → AlertBar → summaryBlock → 学生表 全部显示
// 只用 #kernel/client/index.js 的公开导出。
import { useState } from 'react';
import { useTeacherStage, DataTable, AlertBar, DetailModal, Chip, Row } from '#kernel/client/index.js';

const pre = (value) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--fs-sm)' }}>{JSON.stringify(value, null, 2)}</pre>;

export default function StatsPage({ stageId, columns = [], summary, rowDetail, summaryBlock }) {
  const { roster, perStudent, perClass, options, send, alerts, view } = useTeacherStage(stageId);
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
        const snapRecord = snap?.stageData?.[stageId];
        const record = snapRecord ?? perStudent[detail];
        if (typeof rowDetail === 'function') return rowDetail(record, detailStudent, { fromSnapshot: snapRecord != null });
        return pre(record ?? null);
      },
    },
    { id: 'events', label: '事件', render: (snap) => pre(snap?.events ?? []) },
  ];

  const block = typeof summaryBlock === 'function'
    ? summaryBlock({ roster, perStudent, perClass, options, send })
    : summaryBlock;
  const hasBlock = block != null && block !== false;
  const showChips = view !== 'table';
  const showBlock = view !== 'table' && hasBlock;
  const showTable = view === 'table' || view !== 'stats' || !hasBlock;

  return (
    <>
      {showChips && chips.length > 0 && (
        <Row gap={2} data-testid="stats-summary">
          {chips.map((c) => (
            <Chip key={c.label} tone="brand">{c.label} {c.value}</Chip>
          ))}
        </Row>
      )}
      <AlertBar alerts={alerts} />
      {showBlock && block}
      {showTable && (
        <DataTable
          columns={tableColumns}
          rows={rows}
          rowKey="name"
          offlineKey="connected"
          defaultSort={{ key: 'name', dir: 'asc' }}
          onRowClick={(r) => setDetail(r.name)}
        />
      )}
      {detail && <DetailModal name={detail} tabs={tabs} onClose={() => setDetail(null)} />}
    </>
  );
}
