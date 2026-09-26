// data-analysis 教师演示视图（大屏）：focus 模板。已运行 N/M（在线，标题区提示）、已出图 N（按 firstImageAt）；
// 投到大屏的学生（perClass.featured）：显示其图（大，按宽度缩放）+ 代码（折叠）——P3：有最终稿（final）优先显示最终稿，否则最近运行；
// Page.Actions："换一份展示"（teacher:feature-next，在出过图的学生里按首次出图先后轮换）、有 featured 时"取消展示"。
import { useTeacherStage, Btn, Chip, Fill, Page, Row, Stack } from '#kernel/client/index.js';
import { everImage, finalOf, hasImage } from './primitive.config.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const imgStyle = { display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto', background: 'var(--surface)', borderRadius: 'var(--radius-sm)' };
const codeBox = {
  margin: 'var(--sp-2) 0 0',
  padding: 'var(--sp-3)',
  fontFamily: MONO,
  fontSize: 'var(--fs-sm)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'var(--surface-alt)',
  borderRadius: 'var(--radius-sm)',
};

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

  return (
    <Page template="focus" title={stage?.label} hint={`已运行 ${ranN}/${online.length}`}>
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
                {rec.error && <div style={{ color: 'var(--bad)', fontFamily: MONO }}>{rec.error}</div>}
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--ink-soft)' }}>代码 · {String(rec.code ?? '').split('\n').length} 行</summary>
                  <pre style={codeBox}>{rec.code}</pre>
                </details>
              </Stack>
            ) : (
              <div style={{ color: 'var(--ink-dim)' }}>尚未投屏</div>
            )}
          </Stack>
        </Fill>
      </Page.Main>
      <Page.Actions>
        {featured && <Btn variant="ghost" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>}
        <Btn variant="accent" disabled={!Object.values(perStudent).some(everImage)} onClick={() => send('teacher:feature-next', {})}>换一份展示</Btn>
      </Page.Actions>
    </Page>
  );
}
