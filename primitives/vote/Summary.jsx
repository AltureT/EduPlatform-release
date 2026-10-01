// vote 统计视图摘要区（T9a，教师视图与学生页重排规格 §2.3：原教师演示视图的主体搬来，TeacherStats 经 StatsPage 的 summaryBlock 放在
// 摘要芯片与提醒条之下）：题目 +（有 prompt 时）正文 + 选项人数柱状；提交 N/M 在摘要芯片里。
// 非匿名时点选项展开该选项的名单；揭晓后正确项高亮并显示正确答案（教师收到完整 options，含保密的 answer）。
// "揭晓"按钮在 TeacherActions.jsx（操作条）。
import { useState } from 'react';
import { useTeacherStage, BarDistribution, Btn, Chip, Fill, Row, Stack } from '#kernel/client/index.js';
import PromptText from '../_shared/PromptText.jsx';
import { countChoices, formatChoice, namesFor } from './choices.js';

const questionStyle = { fontSize: 'var(--fs-lg)', fontWeight: 600, lineHeight: 1.5 };
// BarDistribution 的根只按内容高；放进纵向撑满的单格网格里，它随网格行拉伸到 Fill 的可用高度（统计视图摘要区撑满提醒条以下）
const chartBox = { flex: '1 1 0%', minHeight: 0, display: 'grid', paddingBottom: 'var(--sp-4)' };

export default function Summary({ stageId } = {}) {
  const { options, roster, perStudent, perClass, subPhase } = useTeacherStage(stageId);
  const [openKey, setOpenKey] = useState(null);

  if (!options) return null;

  const { question, choices, anonymous } = options;
  const answer = options.answer ?? perClass?.answer ?? null;
  const counts = countChoices(options, perStudent);
  const revealed = !!answer && (subPhase === 'reveal' || perClass?.revealedAt != null);
  const items = choices.map((c) => ({
    label: `${c.key}. ${c.text}`,
    value: counts[c.key],
    color: revealed ? (answer.includes(c.key) ? 'var(--good)' : 'var(--ink-dim)') : undefined,
  }));
  const openNames = openKey ? namesFor(options, openKey, roster, perStudent) : [];

  return (
    <Fill data-testid="vote-summary">
      <div style={questionStyle}>{question}</div>
      <PromptText text={options.prompt} size="lg" />
      <div style={chartBox} data-testid="vote-chart">
        <BarDistribution items={items} />
      </div>
      <Stack gap={3}>
        {revealed && (
          <Row gap={2}>
            <Chip tone="good">正确答案：{formatChoice(options, answer)}</Chip>
          </Row>
        )}
        {!anonymous && (
          <Row gap={2}>
            {choices.map((c) => (
              <Btn
                key={c.key}
                variant={openKey === c.key ? 'primary' : 'ghost'}
                aria-expanded={openKey === c.key}
                onClick={() => setOpenKey(openKey === c.key ? null : c.key)}
              >
                {c.key} · {counts[c.key]} 人
              </Btn>
            ))}
          </Row>
        )}
        {!anonymous && openKey && (
          <Row gap={2} data-testid="vote-names">
            {openNames.length === 0 ? <Chip tone="neutral">无人选择</Chip> : openNames.map((n) => <Chip key={n}>{n}</Chip>)}
          </Row>
        )}
      </Stack>
    </Fill>
  );
}
