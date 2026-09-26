// vote 教师演示视图（大屏）：focus 模板，题目 +（有 prompt 时）正文 + 选项人数柱状（Fill 撑满内容区）+ 提交 N/M（在线）；
// 非匿名时点选项展开该选项的名单；有 answer 且子阶段为 answer 时 Page.Actions 放"揭晓"（teacher:reveal）；
// 揭晓后正确项高亮并显示正确答案（教师收到完整 options，含保密的 answer）。推进由外壳操作条提供。
import { useState } from 'react';
import { useTeacherStage, BarDistribution, Btn, Chip, Fill, Page, Row, Stack } from '#kernel/client/index.js';
import PromptText from '../_shared/PromptText.jsx';
import { countChoices, formatChoice, namesFor } from './choices.js';

// BarDistribution 的根只按内容高；放进纵向撑满的单格网格里，它随网格行拉伸到 Fill 的可用高度
const chartBox = { flex: '1 1 0%', minHeight: 0, display: 'grid', paddingBottom: 'var(--sp-4)' };

export default function TeacherDemo({ stageId } = {}) {
  const { options, roster, perStudent, perClass, subPhase, isLive, send } = useTeacherStage(stageId);
  const [openKey, setOpenKey] = useState(null);

  if (!options) return <Page template="focus" />;

  const { question, choices, anonymous } = options;
  const answer = options.answer ?? perClass?.answer ?? null;
  const counts = countChoices(options, perStudent);
  const connected = roster.filter((s) => s.connected);
  const submitted = connected.filter((s) => perStudent[s.name]?.choice != null).length;
  const revealed = !!answer && (subPhase === 'reveal' || perClass?.revealedAt != null);
  const items = choices.map((c) => ({
    label: `${c.key}. ${c.text}`,
    value: counts[c.key],
    color: revealed ? (answer.includes(c.key) ? 'var(--good)' : 'var(--ink-dim)') : undefined,
  }));
  const openNames = openKey ? namesFor(options, openKey, roster, perStudent) : [];

  return (
    <Page template="focus" title={question} hint={`提交 ${submitted}/${connected.length}`}>
      <Page.Main>
        <Fill>
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
      </Page.Main>
      {options.answer && isLive && subPhase === 'answer' && (
        <Page.Actions>
          <Btn variant="accent" onClick={() => send('teacher:reveal', {})}>揭晓</Btn>
        </Page.Actions>
      )}
    </Page>
  );
}
