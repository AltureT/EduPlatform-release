// quiz 教师演示视图（大屏）：focus 模板，标题为阶段名，hint 为"提交 N/M（在线）"，显示正确率时再加"· 平均分 x / 满分"；
// 有 options.prompt（P4）时正文在最上方。
// 大屏全班都看得见，每题一行的内容按 showResultTo 与是否揭晓而定，免得正确率 + 分布一算就推出答案：
//   student-after-submit：正确率横条（答对 / 已提交），不提供分布展开；
//   reveal 揭晓前：只显示"已答 n / 已提交 m"横条，没有百分比，分布不可展开；
//   never：只显示"已答 n / 已提交 m"横条，点题号可展开作答分布，但不显示对错与正确答案；
//   reveal 揭晓后：正确率横条 + 点题号展开分布，正确项高亮并显示正确答案。
// 教师收到完整 options，按 answerKey 现算。reveal 模式子阶段为 answer 时 Page.Actions 放"揭晓"（teacher:reveal）。
import { useState } from 'react';
import { useTeacherStage, Bar, BarDistribution, Btn, Chip, Page, Row, Stack } from '#kernel/client/index.js';
import PromptText from '../_shared/PromptText.jsx';
import { averageScore, formatKey, gradeOne, itemStats, pct } from './items.js';

const rowGrid = {
  display: 'grid',
  gridTemplateColumns: 'minmax(6em, max-content) minmax(0, 1fr) minmax(3em, max-content)',
  alignItems: 'center',
  gap: 'var(--sp-3)',
};
const itemLabel = { fontWeight: 600, fontSize: 'var(--fs-md)', textAlign: 'center' };
const pctText = { fontFamily: 'ui-monospace, monospace', textAlign: 'right', fontSize: 'var(--fs-lg)' };

function Distribution({ item, stat, answerKey, highlight }) {
  let entries;
  if (item.type === 'single') {
    const counts = new Map(stat.dist.map((d) => [d.value, d.count]));
    entries = item.choices.map((c) => ({ label: `${c.key}. ${c.text}`, value: counts.get(c.key) ?? 0, v: c.key }));
  } else if (item.type === 'truefalse') {
    const counts = new Map(stat.dist.map((d) => [d.value, d.count]));
    entries = [{ label: '对', value: counts.get(true) ?? 0, v: true }, { label: '错', value: counts.get(false) ?? 0, v: false }];
  } else {
    entries = [...stat.dist].sort((a, b) => b.count - a.count).slice(0, 8).map((d) => ({ label: String(d.value), value: d.count, v: d.value }));
  }
  const items = entries.map((e) => ({
    label: e.label,
    value: e.value,
    color: highlight ? (gradeOne(item, answerKey[item.id], e.v) ? 'var(--good)' : 'var(--ink-dim)') : undefined,
  }));
  return (
    <Stack gap={2} data-testid="quiz-item-dist">
      <div style={{ fontSize: 'var(--fs-lg)', whiteSpace: 'pre-wrap' }}>{item.question}</div>
      {items.length === 0 ? <Row gap={2}><Chip tone="neutral">还没有人作答</Chip></Row> : <BarDistribution items={items} horizontal />}
      {highlight && <Row gap={2}><Chip tone="good">正确答案：{formatKey(item, answerKey[item.id])}</Chip></Row>}
      {!highlight && item.type === 'blank' && stat.answered > items.reduce((s, x) => s + x.value, 0) && (
        <div style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>只列出人数最多的 8 种写法</div>
      )}
    </Stack>
  );
}

export default function TeacherDemo({ stageId } = {}) {
  const { stage, options, roster, perStudent, perClass, subPhase, isLive, send } = useTeacherStage(stageId);
  const [openId, setOpenId] = useState(null);

  if (!options) return <Page template="focus" />;

  const total = options.items.length;
  const connected = roster.filter((s) => s.connected);
  const done = connected.filter((s) => perStudent[s.name]?.submittedAt != null).length;
  const avg = averageScore(options, perStudent);
  const stats = itemStats(options, perStudent);
  const reveal = options.showResultTo === 'reveal';
  const revealed = reveal && (subPhase === 'reveal' || perClass?.revealedAt != null);
  const answerKey = options.answerKey ?? perClass?.answerKey ?? {};
  const mode = options.showResultTo;
  const showRate = mode === 'student-after-submit' || revealed;
  // 平均分同样只在显示正确率时上大屏（never / 揭晓前的平均分能让全对的学生推出自己全对）
  const hint = `提交 ${done}/${connected.length}${showRate ? ` · 平均分 ${avg == null ? '—' : avg.toFixed(1)} / ${total}` : ''}`;
  const expandable = mode === 'never' || revealed;
  const openItem = expandable && openId ? options.items.find((it) => it.id === openId) : null;

  return (
    <Page template="focus" title={stage?.label ?? '小测验'} hint={hint}>
      <Page.Main>
        <Stack gap={4}>
          <PromptText text={options.prompt} size="lg" />
          <Stack gap={2} data-testid="quiz-item-rates">
            {options.items.map((it, i) => {
              const st = stats[it.id];
              const rate = pct(st.correct, st.submitted);
              const on = openId === it.id;
              const label = `第 ${i + 1} 题`;
              return (
                <div key={it.id} style={rowGrid}>
                  {expandable
                    ? <Btn variant={on ? 'primary' : 'ghost'} aria-expanded={on} onClick={() => setOpenId(on ? null : it.id)}>{label}</Btn>
                    : <span style={itemLabel}>{label}</span>}
                  {showRate
                    ? <Bar value={rate} max={100} height={14} color={rate < 50 ? 'var(--warn)' : 'var(--brand)'} />
                    : <Bar value={st.answered} max={Math.max(1, st.submitted)} height={14} color="var(--ink-dim)" />}
                  <span style={pctText} data-testid="quiz-item-rate">{showRate ? `${rate}%` : `${st.answered}/${st.submitted}`}</span>
                </div>
              );
            })}
          </Stack>
          {openItem && <Distribution item={openItem} stat={stats[openItem.id]} answerKey={answerKey} highlight={revealed} />}
        </Stack>
      </Page.Main>
      {reveal && isLive && subPhase === 'answer' && (
        <Page.Actions>
          <Btn variant="accent" onClick={() => send('teacher:reveal', {})}>揭晓</Btn>
        </Page.Actions>
      )}
    </Page>
  );
}
