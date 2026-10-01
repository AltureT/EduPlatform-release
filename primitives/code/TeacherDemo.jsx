// code 教师演示视图（大屏）：focus 模板。标题区提示已运行 N/M（在线）、测试全过 N（有 tests 时；按 firstPassedAt）、最近报错 Top 3（按报错首行聚合）；
// 教师从统计页"投到大屏"的学生（perClass.featured）：显示其代码与输出（<PyOutput>）——P3：有最终稿（final）优先显示最终稿，否则最近运行；
// Page.Actions：有 solution 时"显示 / 隐藏参考答案"（teacher:show-solution；参考答案来自教师端完整 options），有 featured 时"取消展示"。
// P6（代码段教学功能规格 §2.4）：有 solution 时另有"公布参考答案给学生"（ConfirmAdvanceBtn，两次点击）→ teacher:publish-solution { on: true }；
// 已公布时换成"撤回参考答案"（{ on: false }），标题区提示加"参考答案已公布 HH:MM"。
// U6：投屏代码与参考答案用 <CodeView size="md" wrap>（高亮，大屏保持折行）。
// P7（教师现场演示规格 §2）：Page.Actions 恒有"现场演示"（Btn soft）→ Main 换成演示区（_shared/LiveDemo：教师模式 PyRunner，
// 初始为本段起始代码，多份时第一份；载入起始代码 / 参考答案；"下发给学生"→ teacher:push-code）；按钮变"收起演示"，收起回到原内容。
// 打开状态按段记（换段自动收起）；演示代码由 LiveDemo 留在内存里（同段再打开还在，换段清空）。
import { useState } from 'react';
import { useTeacherStage, Btn, Chip, CodeView, Fill, Page, Row, Stack } from '#kernel/client/index.js';
import { PyOutput } from '@components/sandbox/index.js';
import { finalOf, hasTestsIn, testsPassed, topErrors } from './record.js';
import { PublishSolutionBtn, publishedHint } from '../_shared/SolutionPanel.jsx';
import LiveDemo from '../_shared/LiveDemo.jsx';
import { pushedOf } from '../_shared/pushCode.js';

const heading = { fontWeight: 600, color: 'var(--ink-soft)' };

export default function TeacherDemo({ stageId } = {}) {
  const { stage, options, roster, perStudent, perClass, send } = useTeacherStage(stageId);
  const id = stageId ?? stage?.id;
  const [demoFor, setDemoFor] = useState(null);   // 打开演示区的段 id
  if (!options) return <Page template="focus" />;

  const demo = demoFor != null && demoFor === id;
  const starters = Array.isArray(options.starters) && options.starters.length >= 2
    ? options.starters
    : [{ label: '起始代码', code: options.starter ?? stage?.sandbox?.starter ?? '' }];

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
  const publishedAt = options.solution ? perClass?.solutionPublishedAt ?? null : null;

  return (
    <Page template="focus" title={stage?.label} hint={`已运行 ${ranN}/${online.length}${publishedHint(publishedAt)}`}>
      <Page.Main>
        {demo ? (
          <LiveDemo stageId={id} starters={starters} solution={options.solution} pushed={pushedOf(perClass)} send={send} />
        ) : (
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
        )}
      </Page.Main>
      <Page.Actions>
        <Btn variant="soft" onClick={() => setDemoFor(demo ? null : id)}>{demo ? '收起演示' : '现场演示'}</Btn>
        {featured && <Btn variant="ghost" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>}
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
