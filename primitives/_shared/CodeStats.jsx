// code / data-analysis 共用的教师统计视图（活动原语规格 §3.4、§3.5），基于统一骨架 StatsPage。只给原语作者用。
//
//   <CodeStats stageId mode="code" | "data" hasTests onFeature? starters? mistakes? summaryBlock? python? />
//   T9a（教师视图与学生页重排规格 §2.1、§2.3）：summaryBlock 原样交给 StatsPage（统计视图的摘要区，原演示视图主体）；
//   python = { ready, online }（TeacherStats 用 sandbox 的 usePythonReady 算，本段是当前段且有 sandbox 配置时才给）→ 摘要芯片多一枚"Python 就绪 N/M"
//   列：运行次数 / （data）已出图 / 最近报错（首行，截 60 字）/ （hasTests）测试 通过/总数 / 已上交（finalAt）/ 最近运行（submittedAt）
//   摘要（在线口径）：已运行 N/M、无报错 N、已上交 N/M、（hasTests）测试全过 N 或（data）已出图 N——后两个按 firstPassedAt / firstImageAt
//   行详情：两个标签"最终稿 / 最近运行"（各用 sandbox 的 <PyOutput record>；有最终稿时缺省最终稿）；
//   给了 onFeature(name) 时加"投到大屏"（该生正在大屏上时显示芯片；大屏优先显示最终稿）
// 记录为 sandbox 记录形状（代码沙盒规格 §3.6）+ submittedAt；学生每次运行 / 测试后自动更新。
// K10：自动记录推来的 final 可能只是摘要（lite: true，_shared/finalLite.js）：列只用 finalAt 与 final.afterSolution；
//   行详情用 DetailModal 拉到的完整记录（服务端存储）；快照里没有这条、退回推送来的摘要时显示"载入中…"，快照里的仍是摘要时提示未载入
// P3：学生点"上交最终稿"后记录多 final { code, stdout, error, images, tests, at } 与 finalAt（覆盖式）。
// P6（代码段教学功能规格 §2.4）：记录的 afterSolution（最近运行）/ final.afterSolution（最终稿）为真时，"最近运行 / 已上交"两列的值
//   与行详情标签后缀"（答案后）"；公布过参考答案（perClass.solutionPublishedAt 或有记录带标记）时摘要加"答案公布后又运行 N 人"
//   （在线口径，任一记录——自动记录或最终稿——带 afterSolution 即算；标记是历史的，撤回后不会减少）。
// P6（§4.3）：starters（code 多份起始代码的 label 数组，≥ 2 时生效）——行详情第一行"起点：框架版"（记录的 starterLabel，没有为 —），
//   摘要加"起点 框架版 N · 空白版 M"（在线口径，按 label 顺序）。
// P7（教师现场演示规格 §6）：记录带 fromTeacher（学生用了老师下发的代码）时不加列，"最近运行"格包一层 title"用了老师下发的代码"
//   （统计视图没有单独的"代码"列，挂在最近运行这格；文字不变）。
// V2（代码题批改规格 §4.4）：mistakes（code 的 options.mistakes，教师端才有）且 mode === 'code' 时——列"错误类型"（记录的 mistake.label；
//   测试全过为空、有失败但没匹配显示"其它"、没测过为 —）；摘要"错误分类：<label> N · 其它 K"（在线口径，按人数降序，只列 > 0）；
//   行详情加一行"老师预判：<label> · 提示：<hint>"（有 hint 时才带提示）。教师按分类点行、"投到大屏"照旧
import { useState } from 'react';
import { useTeacherStage, Btn, Chip, Row, Stack } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';
import StatsPage from './StatsPage.jsx';
import { isLiteFinal } from './finalLite.js';

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
const hasRun = (r) => Number(r?.runs) >= 1;
const hasImage = (r) => Array.isArray(r?.images) && r.images.length > 0;
// 芯片"测试全过 / 已出图"看只记一次的 firstPassedAt / firstImageAt（学生之后改代码不会掉出）；列显示最近一条记录
const everPassed = (r) => r?.firstPassedAt != null;
const everImage = (r) => r?.firstImageAt != null;
const hasFinal = (r) => r?.finalAt != null && r?.final != null && typeof r.final === 'object';
export const AFTER = '（答案后）';
export const FROM_TEACHER = '用了老师下发的代码';
const afterRun = (r) => r?.afterSolution === true;
const afterFinal = (r) => hasFinal(r) && r.final.afterSolution === true;
export const OTHER = '其它';
const failedTests = (t) => !!t && typeof t === 'object' && Number(t.failed) + Number(t.errors) > 0;
// 记录的错误类型：mistake.label；有失败没匹配 → 其它；全过 → ''；没测过 → null
export function mistakeLabel(r) {
  if (r?.mistake && typeof r.mistake.label === 'string') return r.mistake.label;
  if (failedTests(r?.tests)) return OTHER;
  return r?.tests ? '' : null;
}
export function errorHead(r, max = 60) {
  const s = String(r?.error ?? '').split('\n')[0].trim();
  return s.length > max ? s.slice(0, max) : s;
}

// 行详情的两个标签：最终稿 / 最近运行
function RecordTabs({ record, fromSnapshot = false }) {
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
        ? (hasFinal(record) && isLiteFinal(record.final)
          ? <div style={{ color: 'var(--ink-dim)' }}>{fromSnapshot ? '最终稿内容没有载入，关掉再打开试试' : '载入中…'}</div>
          : hasFinal(record)
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

export default function CodeStats({ stageId, mode = 'code', hasTests = false, onFeature, starters, mistakes, summaryBlock, python }) {
  const labels = Array.isArray(starters) && starters.length >= 2 ? starters : null;
  const lib = mode === 'code' && Array.isArray(mistakes?.mistakes) ? mistakes.mistakes : null;
  const hintOf = (id) => lib?.find((m) => m?.id === id) ?? null;
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
    ...(lib
      ? [{
        key: 'mistake', label: '错误类型',
        value: (r) => mistakeLabel(r) ?? '',
        render: (r) => mistakeLabel(r) ?? '—',
      }]
      : []),
    {
      key: 'finalAt', label: '已上交', align: 'right', value: (r) => r?.finalAt ?? 0,
      render: (r) => `${fmtTime(r?.finalAt)}${afterFinal(r) ? AFTER : ''}`,
    },
    {
      key: 'submittedAt', label: '最近运行', align: 'right', value: (r) => r?.submittedAt ?? 0,
      render: (r) => {
        const text = `${fmtTime(r?.submittedAt)}${r?.submittedAt && afterRun(r) ? AFTER : ''}`;
        return r?.fromTeacher === true ? <span title={FROM_TEACHER}>{text}</span> : text;
      },
    },
  ];

  const summary = (records, students) => {
    const online = students.filter((s) => s.connected).map((s) => records[s.name]);
    const count = (pred) => online.filter((r) => pred(r)).length;
    const chips = [
      ...(python ? [{ label: 'Python 就绪', value: `${python.ready}/${python.online}` }] : []),
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
    if (lib) {
      const order = [...lib.map((m) => m.label), OTHER];
      const byLabel = order.map((l) => ({ l, n: count((r) => { const x = mistakeLabel(r); return x === l; }) }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n || order.indexOf(a.l) - order.indexOf(b.l));
      if (byLabel.length > 0) chips.push({ label: '错误分类', value: byLabel.map((x) => `${x.l} ${x.n}`).join(' · ') });
    }
    return chips;
  };

  const rowDetail = (record, student, { fromSnapshot = false } = {}) => (
    <Stack gap={3}>
      {labels && <div data-testid="starter-label" style={{ color: 'var(--ink-soft)' }}>起点：{record?.starterLabel ?? '—'}</div>}
      {lib && record?.mistake?.label && (
        <div data-testid="mistake-note" style={{ color: 'var(--ink-soft)' }}>
          老师预判：{record.mistake.label}{hintOf(record.mistake.id)?.hint ? ` · 提示：${hintOf(record.mistake.id).hint}` : ''}
        </div>
      )}
      {typeof onFeature === 'function' && record && student && (
        <Row gap={2}>
          {featured === student.name
            ? <Chip tone="good">大屏展示中</Chip>
            : <Btn variant="accent" onClick={() => onFeature(student.name)}>投到大屏</Btn>}
        </Row>
      )}
      {record ? <RecordTabs record={record} fromSnapshot={fromSnapshot} /> : <div style={{ color: 'var(--ink-dim)' }}>还没有运行记录</div>}
    </Stack>
  );

  return <StatsPage stageId={id} columns={columns} summary={summary} rowDetail={rowDetail} summaryBlock={summaryBlock} />;
}
