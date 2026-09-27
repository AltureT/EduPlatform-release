// code / data-analysis 共用的教师统计视图（活动原语规格 §3.4、§3.5），基于统一骨架 StatsPage。只给原语作者用。
//
//   <CodeStats stageId mode="code" | "data" hasTests onFeature? starters? />
//   列：运行次数 / （data）已出图 / 最近报错（首行，截 60 字）/ （hasTests）测试 通过/总数 / 已上交（finalAt）/ 最近运行（submittedAt）
//   摘要（在线口径）：已运行 N/M、无报错 N、已上交 N/M、（hasTests）测试全过 N 或（data）已出图 N——后两个按 firstPassedAt / firstImageAt
//   行详情：两个标签"最终稿 / 最近运行"（各用 sandbox 的 <PyOutput record>；有最终稿时缺省最终稿）；
//   给了 onFeature(name) 时加"投到大屏"（该生正在大屏上时显示芯片；大屏优先显示最终稿）
// 记录为 sandbox 记录形状（代码沙盒规格 §3.6）+ submittedAt；学生每次运行 / 测试后自动更新。
// P3：学生点"上交最终稿"后记录多 final { code, stdout, error, images, tests, at } 与 finalAt（覆盖式）。
// P6（代码段教学功能规格 §2.4）：记录的 afterSolution（最近运行）/ final.afterSolution（最终稿）为真时，"最近运行 / 已上交"两列的值
//   与行详情标签后缀"（答案后）"；公布过参考答案（perClass.solutionPublishedAt 或有记录带标记）时摘要加"答案公布后又运行 N 人"
//   （在线口径，任一记录——自动记录或最终稿——带 afterSolution 即算；标记是历史的，撤回后不会减少）。
// P6（§4.3）：starters（code 多份起始代码的 label 数组，≥ 2 时生效）——行详情第一行"起点：框架版"（记录的 starterLabel，没有为 —），
//   摘要加"起点 框架版 N · 空白版 M"（在线口径，按 label 顺序）。
import { useState } from 'react';
import { useTeacherStage, Btn, Chip, Row, Stack } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';
import StatsPage from './StatsPage.jsx';

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
const hasRun = (r) => Number(r?.runs) >= 1;
const hasImage = (r) => Array.isArray(r?.images) && r.images.length > 0;
// 芯片"测试全过 / 已出图"看只记一次的 firstPassedAt / firstImageAt（学生之后改代码不会掉出）；列显示最近一条记录
const everPassed = (r) => r?.firstPassedAt != null;
const everImage = (r) => r?.firstImageAt != null;
const hasFinal = (r) => r?.finalAt != null && r?.final != null && typeof r.final === 'object';
export const AFTER = '（答案后）';
const afterRun = (r) => r?.afterSolution === true;
const afterFinal = (r) => hasFinal(r) && r.final.afterSolution === true;
export function errorHead(r, max = 60) {
  const s = String(r?.error ?? '').split('\n')[0].trim();
  return s.length > max ? s.slice(0, max) : s;
}

// 行详情的两个标签：最终稿 / 最近运行
function RecordTabs({ record }) {
  const [tab, setTab] = useState(hasFinal(record) ? 'final' : 'latest');
  const tabBtn = (id, label) => (
    <Btn size="sm" variant={tab === id ? 'primary' : 'soft'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</Btn>
  );
  return (
    <Stack gap={2}>
      <Row gap={2}>
        {tabBtn('final', `最终稿${afterFinal(record) ? AFTER : ''}`)}
        {tabBtn('latest', `最近运行${afterRun(record) ? AFTER : ''}`)}
      </Row>
      {tab === 'final'
        ? (hasFinal(record)
          ? (
            <Stack gap={2}>
              {record.final.stale === true && <div style={{ color: 'var(--warn)', fontSize: 'var(--fs-sm)' }}>上交时代码改过，输出来自上次运行</div>}
              <PyOutput record={record.final} label={`上交于 ${fmtTime(record.finalAt)}`} />
            </Stack>
          )
          : <div style={{ color: 'var(--ink-dim)' }}>还没上交最终稿</div>)
        : <PyOutput record={record} />}
    </Stack>
  );
}

export default function CodeStats({ stageId, mode = 'code', hasTests = false, onFeature, starters }) {
  const labels = Array.isArray(starters) && starters.length >= 2 ? starters : null;
  const { stage, perClass } = useTeacherStage(stageId);
  const id = stageId ?? stage?.id;
  const data = mode === 'data';
  const featured = perClass?.featured ?? null;

  const columns = [
    { key: 'runs', label: '运行次数', align: 'right', value: (r) => (hasRun(r) ? r.runs : -1), render: (r) => (hasRun(r) ? r.runs : '—') },
    ...(data
      ? [{
        key: 'image', label: '已出图', align: 'center',
        value: (r) => (r ? (hasImage(r) ? 1 : 0) : -1),
        render: (r) => (r ? (hasImage(r) ? '是' : '否') : '—'),
      }]
      : []),
    { key: 'error', label: '最近报错', value: (r) => errorHead(r), render: (r) => errorHead(r) || '—' },
    ...(hasTests
      ? [{
        key: 'tests', label: '测试', align: 'center',
        value: (r) => (r?.tests && Number(r.tests.total) > 0 ? r.tests.passed / r.tests.total : -1),
        render: (r) => (r?.tests ? `${r.tests.passed} / ${r.tests.total}` : '—'),
      }]
      : []),
    {
      key: 'finalAt', label: '已上交', align: 'right', value: (r) => r?.finalAt ?? 0,
      render: (r) => `${fmtTime(r?.finalAt)}${afterFinal(r) ? AFTER : ''}`,
    },
    {
      key: 'submittedAt', label: '最近运行', align: 'right', value: (r) => r?.submittedAt ?? 0,
      render: (r) => `${fmtTime(r?.submittedAt)}${r?.submittedAt && afterRun(r) ? AFTER : ''}`,
    },
  ];

  const summary = (records, students) => {
    const online = students.filter((s) => s.connected).map((s) => records[s.name]);
    const count = (pred) => online.filter((r) => pred(r)).length;
    const chips = [
      { label: '已运行', value: `${count(hasRun)}/${online.length}` },
      { label: '无报错', value: count((r) => hasRun(r) && !r.error) },
      { label: '已上交', value: `${count(hasFinal)}/${online.length}` },
    ];
    if (hasTests) chips.push({ label: '测试全过', value: count(everPassed) });
    if (data) chips.push({ label: '已出图', value: count(everImage) });
    const afterAny = (r) => afterRun(r) || afterFinal(r);
    if (perClass?.solutionPublishedAt != null || Object.values(records ?? {}).some(afterAny)) {
      chips.push({ label: '答案公布后又运行', value: `${count(afterAny)} 人` });
    }
    if (labels) chips.push({ label: '起点', value: labels.map((l) => `${l} ${count((r) => r?.starterLabel === l)}`).join(' · ') });
    return chips;
  };

  const rowDetail = (record, student) => (
    <Stack gap={3}>
      {labels && <div data-testid="starter-label" style={{ color: 'var(--ink-soft)' }}>起点：{record?.starterLabel ?? '—'}</div>}
      {typeof onFeature === 'function' && record && student && (
        <Row gap={2}>
          {featured === student.name
            ? <Chip tone="good">大屏展示中</Chip>
            : <Btn variant="accent" onClick={() => onFeature(student.name)}>投到大屏</Btn>}
        </Row>
      )}
      {record ? <RecordTabs record={record} /> : <div style={{ color: 'var(--ink-dim)' }}>还没有运行记录</div>}
    </Stack>
  );

  return <StatsPage stageId={id} columns={columns} summary={summary} rowDetail={rowDetail} />;
}
