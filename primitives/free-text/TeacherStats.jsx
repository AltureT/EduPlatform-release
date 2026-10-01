// free-text 教师统计视图：统一骨架 StatsPage（活动原语规格 §2.6）。
// 列：姓名 / 已提交 / 各题字数（单题"字数"，多题"字数 1""字数 2"…）/ 首句预览（第一道有作答的题）/ 提交时间；
// 摘要：提交 N/M（在线）、展示中（有 featured 快照时）；点行看全文，"投到大屏"发 teacher:feature（已在展示时为"取消展示"，
// 该生投屏后又更新过时多一个"投最新版本"）。
// T9a（教师视图与学生页重排规格 §2.3）：统计视图摘要区 = Summary.jsx（原演示视图主体：投屏的那条作答，没投屏时题目列表）；
// 明细表 = 学生表（点行"投到大屏"在这里）。
import { useTeacherStage, Btn, Row, Stack } from '#kernel/client/index.js';
import StatsPage from '../_shared/StatsPage.jsx';
import Summary from './Summary.jsx';
import { countChars, firstSentence } from './prompts.js';

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

export default function TeacherStats({ stageId } = {}) {
  const { stage, options, perClass, send } = useTeacherStage(stageId);
  const id = stageId ?? stage?.id;
  if (!options) return <StatsPage stageId={id} />;

  const { prompts } = options;
  const snap = perClass?.featured && typeof perClass.featured.name === 'string' ? perClass.featured : null;
  const featured = snap ? snap.name : null;
  const done = (r) => r?.submittedAt != null;
  const firstText = (r) => {
    const p = prompts.find((x) => countChars(r?.answers?.[x.id]) > 0);
    return p ? r.answers[p.id] : '';
  };

  const columns = [
    { key: 'submitted', label: '已提交', align: 'center', value: (r) => (done(r) ? 1 : 0), render: (r) => (done(r) ? '是' : '否') },
    ...prompts.map((p, i) => ({
      key: `len-${p.id}`,
      label: prompts.length === 1 ? '字数' : `字数 ${i + 1}`,
      align: 'right',
      value: (r) => (done(r) ? countChars(r.answers?.[p.id]) : -1),
      render: (r) => (done(r) ? String(countChars(r.answers?.[p.id])) : '—'),
    })),
    { key: 'preview', label: '首句预览', value: (r) => firstSentence(firstText(r)), render: (r) => firstSentence(firstText(r)) || '—' },
    { key: 'submittedAt', label: '提交时间', align: 'right', value: (r) => r?.submittedAt ?? 0, render: (r) => fmtTime(r?.submittedAt) },
  ];

  const summary = (records, students) => {
    const online = students.filter((s) => s.connected);
    const n = online.filter((s) => done(records[s.name])).length;
    const chips = [{ label: '提交', value: `${n}/${online.length}` }];
    if (featured) chips.push({ label: '展示中', value: featured });
    return chips;
  };

  const rowDetail = (record, student) => {
    if (!done(record)) return <div>未提交</div>;
    const name = student?.name;
    const showing = name != null && featured === name;
    // 投屏的是快照；该生之后又更新过，可以再投一次取最新
    const stale = showing && typeof snap.at === 'number' && record.submittedAt > snap.at;
    return (
      <Stack gap={3}>
        {prompts.map((p) => (
          <Stack gap={1} key={p.id}>
            <div style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>{p.title}（{countChars(record.answers?.[p.id])} 字）</div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{record.answers?.[p.id] || '（未作答）'}</div>
          </Stack>
        ))}
        <div style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>提交时间：{fmtTime(record.submittedAt)}</div>
        {name != null && (
          <Row gap={2}>
            {showing
              ? <Btn variant="soft" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>
              : <Btn variant="accent" onClick={() => send('teacher:feature', { name })}>投到大屏</Btn>}
            {stale && <Btn variant="accent" onClick={() => send('teacher:feature', { name })}>投最新版本</Btn>}
          </Row>
        )}
      </Stack>
    );
  };

  return <StatsPage stageId={id} columns={columns} summary={summary} rowDetail={rowDetail} summaryBlock={<Summary stageId={id} />} />;
}
