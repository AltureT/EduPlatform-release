// data-analysis 教师演示视图（大屏）：focus 模板。已运行 N/M（在线，标题区提示）、已出图 N（按 firstImageAt）；
// 投到大屏的学生（perClass.featured）：显示其图（大，按宽度缩放）+ 代码（折叠）——P3：有最终稿（final）优先显示最终稿，否则最近运行；
// Page.Actions："换一份展示"（teacher:feature-next，在出过图的学生里按首次出图先后轮换）、有 featured 时"取消展示"。
// P6（代码段教学功能规格 §2.1、§2.4）：有 solution 时"显示 / 隐藏参考答案"（teacher:show-solution，大屏显示参考答案，同 code）
// 与"公布参考答案给学生 / 撤回参考答案"（teacher:publish-solution，两次点击确认）；已公布时标题区提示加"参考答案已公布 HH:MM"。
// U6：投屏代码与参考答案用 <CodeView size="md" wrap>（高亮，大屏保持折行）。
import { useTeacherStage, Btn, Chip, CodeView, Fill, Page, Row, Stack } from '#kernel/client/index.js';
import { everImage, finalOf, hasImage } from './primitive.config.js';
import { PublishSolutionBtn, publishedHint } from '../_shared/SolutionPanel.jsx';

const imgStyle = { display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto', background: 'var(--surface)', borderRadius: 'var(--radius-sm)' };

export default function TeacherDemo({ stageId } = {}) {
  const { stage, options, roster, perStudent, perClass, send } = useTeacherStage(stageId);
  if (!options) return <Page template="focus" />;

  const online = roster.filter((s) => s.connected);
  const ranN = online.filter((s) => Number(perStudent[s.name]?.runs) >= 1).length;
  const imgN = online.filter((s) => everImage(perStudent[s.name])).length;
  const featured = perClass?.featured ?? null;
  const latest = featured ? perStudent[featured] : null;
  const fin = finalOf(latest);
  const rec = fin ?? latest;
  const img = hasImage(rec) ? rec.images[0] : null;
  const showSolution = !!options.solution && perClass?.showSolution === true;
  const publishedAt = options.solution ? perClass?.solutionPublishedAt ?? null : null;

  return (
    <Page template="focus" title={stage?.label} hint={`已运行 ${ranN}/${online.length}${publishedHint(publishedAt)}`}>
      <Page.Main>
        <Fill scroll>
          <Stack gap={4}>
            <Row gap={2}>
              <Chip tone="good">已出图 {imgN}</Chip>
            </Row>
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
      </Page.Main>
      <Page.Actions>
        {featured && <Btn variant="ghost" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>}
        <Btn variant="accent" disabled={!Object.values(perStudent).some(everImage)} onClick={() => send('teacher:feature-next', {})}>换一份展示</Btn>
        {options.solution && (
          <Btn variant="soft" onClick={() => send('teacher:show-solution', { on: !showSolution })}>
            {showSolution ? '隐藏参考答案' : '显示参考答案'}
          </Btn>
        )}
        {options.solution && <PublishSolutionBtn publishedAt={publishedAt} send={send} />}
      </Page.Actions>
    </Page>
  );
}
