// code 教师演示视图（大屏）：focus 模板。标题区提示已运行 N/M（在线）、测试全过 N（有 tests 时；按 firstPassedAt）、最近报错 Top 3（按报错首行聚合）；
// 教师从统计页"投到大屏"的学生（perClass.featured）：显示其代码与输出（<PyOutput>）——P3：有最终稿（final）优先显示最终稿，否则最近运行；
// Page.Actions：有 solution 时"显示 / 隐藏参考答案"（teacher:show-solution；参考答案来自教师端完整 options），有 featured 时"取消展示"。
import { useTeacherStage, Btn, Chip, Fill, Page, Row, Stack } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';
import { finalOf, hasTestsIn, testsPassed, topErrors } from './record.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const codeBox = {
  margin: 0,
  padding: 'var(--sp-3)',
  fontFamily: MONO,
  fontSize: 'var(--fs-md, 18px)',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'var(--surface-alt)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
};
const heading = { fontWeight: 600, color: 'var(--ink-soft)' };

export default function TeacherDemo({ stageId } = {}) {
  const { stage, options, roster, perStudent, perClass, send } = useTeacherStage(stageId);
  if (!options) return <Page template="focus" />;

  const withTests = hasTestsIn(options);
  const online = roster.filter((s) => s.connected);
  const ranN = online.filter((s) => Number(perStudent[s.name]?.runs) >= 1).length;
  const passN = online.filter((s) => testsPassed(perStudent[s.name])).length;
  const errors = topErrors(perStudent, 3);
  const featured = perClass?.featured ?? null;
  const latest = featured ? perStudent[featured] : null;
  const fin = finalOf(latest);
  const rec = fin ?? latest;
  const showSolution = !!options.solution && perClass?.showSolution === true;

  return (
    <Page template="focus" title={stage?.label} hint={`已运行 ${ranN}/${online.length}`}>
      <Page.Main>
        <Fill scroll>
          <Stack gap={4}>
            {withTests && (
              <Row gap={2}>
                <Chip tone="good">测试全过 {passN}</Chip>
              </Row>
            )}
            {errors.length > 0 && (
              <Stack gap={2} data-testid="code-top-errors">
                <div style={heading}>最近报错</div>
                {errors.map((e) => (
                  <Row key={e.text} gap={2}>
                    <Chip tone="bad">× {e.count}</Chip>
                    <span style={{ fontFamily: MONO, wordBreak: 'break-word' }}>{e.text}</span>
                  </Row>
                ))}
              </Stack>
            )}
            {rec && (
              <Stack gap={2} data-testid="code-featured">
                <div style={heading}>{featured} 的代码（{fin ? '最终稿' : '最近运行'}）</div>
                <pre style={codeBox}>{rec.code}</pre>
                <PyOutput record={rec} label="输出" hideCode />
              </Stack>
            )}
            {!rec && (
              <div style={{ color: 'var(--ink-dim)' }}>尚未投屏</div>
            )}
            {showSolution && (
              <Stack gap={2} data-testid="code-solution">
                <div style={heading}>参考答案</div>
                <pre style={codeBox}>{options.solution}</pre>
              </Stack>
            )}
          </Stack>
        </Fill>
      </Page.Main>
      {(options.solution || featured) && (
        <Page.Actions>
          {featured && <Btn variant="ghost" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>}
          {options.solution && (
            <Btn variant="soft" onClick={() => send('teacher:show-solution', { on: !showSolution })}>
              {showSolution ? '隐藏参考答案' : '显示参考答案'}
            </Btn>
          )}
        </Page.Actions>
      )}
    </Page>
  );
}
