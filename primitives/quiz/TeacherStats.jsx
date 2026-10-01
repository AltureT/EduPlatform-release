// quiz 教师统计视图：统一骨架 StatsPage（活动原语规格 §2.6）。
// 列：姓名 / 已提交 / 得分 / 错题号 / 用时（限时测验超时 5 秒以上标"超时"）；摘要：提交 N/M（在线）、平均分（已提交者）、最难的题（正确率最低）；
// 点行看逐题作答与对错。得分与对错按 options.answerKey 现算（教师收到完整 options；reveal / never 模式记录里没有 score）。
// T9a（教师视图与学生页重排规格 §2.3）：统计视图摘要区 = Summary.jsx（原演示视图主体：每题正确率条、点题号展开分布）；明细表 = 学生表。
// 统计视图会上大屏：平均分与最难的题只在显示正确率时出现（student-after-submit，或 reveal 已揭晓），never / 揭晓前不显示
// （与原演示视图标题区"平均分"的规则一致：否则全对的学生能推出自己全对）；明细表照常有得分列。
import { useTeacherStage, Stack } from '#kernel/client/index.js';
import StatsPage from '../_shared/StatsPage.jsx';
import Summary from './Summary.jsx';
import { averageScore, formatAnswer, formatNumbers, itemStats, pct, scoreOf, wrongNumbers } from './items.js';

export const fmtElapsed = (ms) => {
  if (typeof ms !== 'number') return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function TeacherStats({ stageId } = {}) {
  const { stage, options, subPhase, perClass } = useTeacherStage(stageId);
  const id = stageId ?? stage?.id;
  if (!options) return <StatsPage stageId={id} />;

  const total = options.items.length;
  const done = (r) => r?.submittedAt != null;
  // 限时测验：用时超过 timeLimitSec + 5 秒（到时自动提交的网络余量）标"超时"——服务端不拒绝超时提交
  const limitMs = options.timeLimitSec ? options.timeLimitSec * 1000 + 5000 : null;
  const overtime = (r) => limitMs != null && typeof r?.elapsedMs === 'number' && r.elapsedMs > limitMs;
  const columns = [
    { key: 'submitted', label: '已提交', align: 'center', value: (r) => (done(r) ? 1 : 0), render: (r) => (done(r) ? '是' : '否') },
    {
      key: 'score',
      label: '得分',
      align: 'center',
      value: (r) => scoreOf(options, r)?.score ?? -1,
      render: (r) => { const g = scoreOf(options, r); return g ? `${g.score}/${g.total}` : '—'; },
    },
    {
      key: 'wrong',
      label: '错题号',
      value: (r) => { const g = scoreOf(options, r); return g ? wrongNumbers(options, g.results).length : -1; },
      render: (r) => { const g = scoreOf(options, r); return g ? formatNumbers(wrongNumbers(options, g.results)) : '—'; },
    },
    { key: 'elapsedMs', label: '用时', align: 'right', value: (r) => r?.elapsedMs ?? -1, render: (r) => (done(r) ? `${fmtElapsed(r.elapsedMs)}${overtime(r) ? ' 超时' : ''}` : '—') },
  ];

  const revealed = options.showResultTo === 'reveal' && (subPhase === 'reveal' || perClass?.revealedAt != null);
  const showRate = options.showResultTo === 'student-after-submit' || revealed;
  const summary = (records, students) => {
    const online = students.filter((s) => s.connected);
    const n = online.filter((s) => done(records[s.name])).length;
    const chips = [{ label: '提交', value: `${n}/${online.length}` }];
    if (!showRate) return chips;
    const avg = averageScore(options, records);
    chips.push({ label: '平均分', value: `${avg == null ? '—' : avg.toFixed(1)} / ${total}` });
    const stats = itemStats(options, records);
    let hardest = null;
    options.items.forEach((it, i) => {
      const st = stats[it.id];
      if (st.submitted === 0) return;
      const rate = pct(st.correct, st.submitted);
      if (!hardest || rate < hardest.rate) hardest = { n: i + 1, rate };
    });
    if (hardest) chips.push({ label: '最难', value: `第 ${hardest.n} 题 ${hardest.rate}%` });
    return chips;
  };

  const rowDetail = (record) => {
    if (!done(record)) return <div>未提交</div>;
    const g = scoreOf(options, record);
    return (
      <Stack gap={2}>
        {options.items.map((it, i) => {
          const ok = g?.results?.[it.id];
          return (
            <div key={it.id}>
              第 {i + 1} 题：{formatAnswer(it, record.answers?.[it.id])}
              {ok != null && <span style={{ color: ok ? 'var(--good)' : 'var(--bad)' }}>（{ok ? '对' : '错'}）</span>}
            </div>
          );
        })}
        <div>得分：{g ? `${g.score} / ${g.total}` : '—'}</div>
        <div>用时：{fmtElapsed(record.elapsedMs)}{overtime(record) ? '（超时）' : ''}</div>
      </Stack>
    );
  };

  return <StatsPage stageId={id} columns={columns} summary={summary} rowDetail={rowDetail} summaryBlock={<Summary stageId={id} />} />;
}
