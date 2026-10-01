// data-analysis 统计视图摘要区（T9a，教师视图与学生页重排规格 §2.3：原教师演示视图的主体搬来，TeacherStats 经 CodeStats / StatsPage 的
// summaryBlock 放在摘要芯片与提醒条之下；已运行 N/M、已出图 N 在摘要芯片里，不重复）：已公布参考答案时一枚"参考答案已公布 HH:MM"；
// 投到大屏的学生（perClass.featured，"投到大屏"或"换一份展示"轮换）：显示其图（大，按宽度缩放）+ 代码（折叠）——P3：有最终稿（final）优先显示最终稿，否则最近运行；
// 显示中的参考答案（perClass.showSolution）。按钮（取消展示、换一份展示、显示 / 隐藏 / 公布 / 撤回参考答案）在 TeacherActions.jsx（操作条）；
// "现场演示"并入演示视图（Student 的演示模式）。U6：投屏代码与参考答案用 <CodeView size="md" wrap>（高亮，大屏保持折行）。
import { useTeacherStage, Chip, CodeView, Fill, Row, Stack } from '#kernel/client/index.js';
import { finalOf, hasImage } from './primitive.config.js';
import { publishedHint } from '../_shared/SolutionPanel.jsx';

const imgStyle = { display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto', background: 'var(--surface)', borderRadius: 'var(--radius-sm)' };

export default function Summary({ stageId } = {}) {
  const { options, perStudent, perClass } = useTeacherStage(stageId);
  if (!options) return null;

  const featured = perClass?.featured ?? null;
  const latest = featured ? perStudent[featured] : null;
  const fin = finalOf(latest);
  const rec = fin ?? latest;
  const img = hasImage(rec) ? rec.images[0] : null;
  const showSolution = !!options.solution && perClass?.showSolution === true;
  const publishedAt = options.solution ? perClass?.solutionPublishedAt ?? null : null;

  return (
    <Fill scroll data-testid="data-summary">
      <Stack gap={4}>
        {publishedAt != null && (
          <Row gap={2}>
            <span data-testid="solution-published"><Chip tone="neutral">{publishedHint(publishedAt).replace(/^ · /, '')}</Chip></span>
          </Row>
        )}
        {rec ? (
          <Stack gap={2} data-testid="data-featured">
            <div style={{ fontWeight: 600, color: 'var(--ink-soft)' }}>{featured} 的{img ? '图' : '运行结果（没有图）'}（{fin ? '最终稿' : '最近运行'}）</div>
            {img && <img alt={`${featured} 的图`} src={`data:image/png;base64,${img}`} style={imgStyle} />}
            {rec.error && <div style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)' }}>{rec.error}</div>}
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--ink-soft)' }}>代码 · {String(rec.code ?? '').split('\n').length} 行</summary>
              <div style={{ marginTop: 'var(--sp-2)' }}><CodeView code={rec.code} size="md" wrap /></div>
            </details>
          </Stack>
        ) : (
          <div style={{ color: 'var(--ink-dim)' }}>尚未投屏</div>
        )}
        {showSolution && (
          <Stack gap={2} data-testid="data-solution">
            <div style={{ fontWeight: 600, color: 'var(--ink-soft)' }}>参考答案</div>
            <CodeView code={options.solution} size="md" wrap />
          </Stack>
        )}
      </Stack>
    </Fill>
  );
}
