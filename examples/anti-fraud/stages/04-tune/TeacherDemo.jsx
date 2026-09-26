import { useState } from 'react';
import { useTeacherStage, Page, Stack, Split } from '#kernel/client/index.js';
import { SAMPLES, evaluate } from './data.js';
import { Sliders, ScoreAxis, Contribution, ResultChips, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD } from './Panel.jsx';

// 演示视图：教师自己的调参面板（本地演示，不发事件、不写记录）；看学生画面 / 邀请由平台默认组件提供
export default function TeacherDemo() {
  const { roster, perStudent } = useTeacherStage('tune');
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const result = evaluate(SAMPLES, weights, threshold);
  const connected = roster.filter((s) => s.connected);
  const tested = connected.filter((s) => (perStudent[s.name]?.tests ?? 0) >= 1).length;

  return (
    <Page template="focus" title="调参面板" hint={`已检验 ${tested}/${connected.length}`}>
      <Page.Main>
        <Split ratio="2:3">
          <Sliders weights={weights} threshold={threshold} onWeight={(k, v) => setWeights((w) => ({ ...w, [k]: v }))} onThreshold={setThreshold} />
          <Stack gap={3}>
            <ResultChips result={result} />
            <ScoreAxis weights={weights} threshold={threshold} />
            <Contribution weights={weights} threshold={threshold} />
          </Stack>
        </Split>
      </Page.Main>
    </Page>
  );
}
