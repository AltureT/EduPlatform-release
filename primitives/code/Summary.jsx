// code 统计视图摘要区（T9a，教师视图与学生页重排规格 §2.3：原教师演示视图的主体搬来，TeacherStats 经 CodeStats / StatsPage 的
// summaryBlock 放在摘要芯片与提醒条之下；已运行 N/M、测试全过 N 也在摘要芯片里）：
// 最近报错 Top 3（按报错首行聚合）；已公布参考答案时一枚"参考答案已公布 HH:MM"（"测试全过 N"只在摘要芯片里，不重复）；
// 教师从明细表"投到大屏"的学生（perClass.featured）：显示其代码与输出（<PyOutput>）——P3：有最终稿（final）优先显示最终稿，否则最近运行；
// 显示中的参考答案（perClass.showSolution，参考答案来自教师端完整 options）。
// 按钮（取消展示、显示 / 隐藏参考答案、公布 / 撤回参考答案）在 TeacherActions.jsx（操作条）；"现场演示"并入演示视图（Student 的演示模式）。
// U6：投屏代码与参考答案用 <CodeView size="md" wrap>（高亮，大屏保持折行）。
import { useTeacherStage, Chip, CodeView, Fill, Row, Stack } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';
import { finalOf, topErrors } from './record.js';
import { publishedHint } from '../_shared/SolutionPanel.jsx';

const heading = { fontWeight: 600, color: 'var(--ink-soft)' };

export default function Summary({ stageId } = {}) {
  const { options, perStudent, perClass } = useTeacherStage(stageId);
  if (!options) return null;

  const errors = topErrors(perStudent, 3);
  const featured = perClass?.featured ?? null;
  const latest = featured ? perStudent[featured] : null;
  const fin = finalOf(latest);
  const rec = fin ?? latest;
  const showSolution = !!options.solution && perClass?.showSolution === true;
  const publishedAt = options.solution ? perClass?.solutionPublishedAt ?? null : null;

  return (
    <Fill scroll data-testid="code-summary">
      <Stack gap={4}>
        {publishedAt != null && (
          <Row gap={2}>
            <span data-testid="solution-published"><Chip tone="neutral">{publishedHint(publishedAt).replace(/^ · /, '')}</Chip></span>
          </Row>
        )}
        {errors.length > 0 && (
          <Stack gap={2} data-testid="code-top-errors">
            <div style={heading}>最近报错</div>
            {errors.map((e) => (
              <Row key={e.text} gap={2}>
                <Chip tone="bad">× {e.count}</Chip>
                <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>{e.text}</span>
              </Row>
            ))}
          </Stack>
        )}
        {rec && (
          <Stack gap={2} data-testid="code-featured">
            <div style={heading}>{featured} 的代码（{fin ? '最终稿' : '最近运行'}）</div>
            <CodeView code={rec.code} size="md" wrap />
            <PyOutput record={rec} label="输出" hideCode />
          </Stack>
        )}
        {!rec && (
          <div style={{ color: 'var(--ink-dim)' }}>尚未投屏</div>
        )}
        {showSolution && (
          <Stack gap={2} data-testid="code-solution">
            <div style={heading}>参考答案</div>
            <CodeView code={options.solution} size="md" wrap />
          </Stack>
        )}
      </Stack>
    </Fill>
  );
}
