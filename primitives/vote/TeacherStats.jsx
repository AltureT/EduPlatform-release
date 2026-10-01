// vote 教师统计视图：统一骨架 StatsPage（活动原语规格 §2.6）。
// 列：姓名 / 已提交 / 选项 / 正确（有 answer）/ 提交时间；摘要：提交 N/M（在线）、（有 answer）答对 N / 已作答 M；点行看该生记录。
// "正确"按 options.answer 现算（教师收到完整 options；记录里的 correct 要到揭晓时才写）。
// 摘要的"答对 / 已作答"含离线学生，与门槛（在线口径）不是同一个数，故不叫"正确率"。
// T9a（教师视图与学生页重排规格 §2.3）：统计视图摘要区 = Summary.jsx（原演示视图主体：题目、选项人数柱状、点选项看名单、揭晓后正确项高亮）；
// 明细表 = 学生表。
import { useTeacherStage, Stack } from '#kernel/client/index.js';
import StatsPage from '../_shared/StatsPage.jsx';
import Summary from './Summary.jsx';
import { formatChoice, isCorrect, orderKeys, toKeys } from './choices.js';

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

export default function TeacherStats({ stageId } = {}) {
  const { stage, options } = useTeacherStage(stageId);
  const id = stageId ?? stage?.id;
  if (!options) return <StatsPage stageId={id} />;

  const hasAnswer = Array.isArray(options.answer);
  const correctOf = (r) => (r?.choice == null ? null : isCorrect(options, r.choice));
  const keysOf = (r) => orderKeys(options, toKeys(r?.choice)).join('、');
  const columns = [
    { key: 'submitted', label: '已提交', align: 'center', value: (r) => (r?.choice != null ? 1 : 0), render: (r) => (r?.choice != null ? '是' : '否') },
    { key: 'choice', label: '选项', align: 'center', value: keysOf, render: (r) => keysOf(r) || '—' },
    ...(hasAnswer
      ? [{
        key: 'correct',
        label: '正确',
        align: 'center',
        value: (r) => { const c = correctOf(r); return c == null ? -1 : c ? 1 : 0; },
        render: (r) => { const c = correctOf(r); return c == null ? '—' : c ? '对' : '错'; },
      }]
      : []),
    { key: 'submittedAt', label: '提交时间', align: 'right', value: (r) => r?.submittedAt ?? 0, render: (r) => fmtTime(r?.submittedAt) },
  ];

  const summary = (records, students) => {
    const online = students.filter((s) => s.connected);
    const done = online.filter((s) => records[s.name]?.choice != null).length;
    const chips = [{ label: '提交', value: `${done}/${online.length}` }];
    if (hasAnswer) {
      const answered = Object.values(records).filter((r) => r?.choice != null);
      const right = answered.filter((r) => correctOf(r) === true).length;
      chips.push({ label: '答对', value: `${right} / 已作答 ${answered.length}` });
    }
    return chips;
  };

  const rowDetail = (record) => (
    <Stack gap={2}>
      <div>选择：{formatChoice(options, record?.choice)}</div>
      {hasAnswer && record?.choice != null && <div>结果：{correctOf(record) ? '答对' : '答错'}</div>}
      <div>提交时间：{fmtTime(record?.submittedAt)}</div>
    </Stack>
  );

  return <StatsPage stageId={id} columns={columns} summary={summary} rowDetail={rowDetail} summaryBlock={<Summary stageId={id} />} />;
}
