import { useRef, useState } from 'react';
import { useStudentStage, Btn, Chip, Page } from '#kernel/client/index.js';
import { PyRunner, buildRecord } from '@components/sandbox/index.js';
import { TASK, allPassed } from './stage.config.js';

const STAGE = 'tests';
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });

export default function Student() {
  const { stage, isLive, myData, send } = useStudentStage(STAGE);
  const [code, setCode] = useState(stage?.sandbox?.starter ?? '');
  const [lastRun, setLastRun] = useState(null);     // { code, result }
  const [lastTest, setLastTest] = useState(null);   // { code, t }（刷新后由 onRestore 恢复：t 只有四个计数 + stdout / ms）
  const runs = useRef(0);                            // PyRunner 本实例运行 + 测试次数
  const codeRef = useRef(code);
  codeRef.current = code;

  // 测试结果只对测试时的代码有效：改了代码就要重新测试
  const tested = lastTest && lastTest.code === code ? lastTest : null;
  const canSubmit = isLive && !!tested && allPassed(tested.t);

  const onRestore = ({ code: ranCode, result }) => {
    if (result.kind === 'test') setLastTest({ code: ranCode, t: { ...result.tests, stdout: result.stdout, ms: result.ms } });
    else setLastRun({ code: ranCode, result });
  };
  const submit = () => {
    if (!canSubmit) return;
    const run = lastRun && lastRun.code === tested.code ? lastRun.result : { stdout: tested.t.stdout, ms: tested.t.ms };
    send('student:submit', buildRecord(run, { code: tested.code, tests: tested.t, runs: runs.current }));
  };

  return (
    <Page template="split" title={TASK}>
      <Page.Main>
        <PyRunner
          stageId={STAGE}
          code={code}
          onChange={setCode}
          onResult={(result, info) => {
            runs.current = info?.runs ?? runs.current;
            setLastRun({ code: codeRef.current, result });
          }}
          onTest={(t, info) => {
            runs.current = info?.runs ?? runs.current;
            setLastTest({ code: codeRef.current, t });
          }}
          onRestore={onRestore}
        />
      </Page.Main>
      <Page.Actions>
        {myData?.submittedAt != null && (
          <Chip tone="good">已提交 {fmtTime(myData.submittedAt)}</Chip>
        )}
        <Btn variant="accent" disabled={!canSubmit} onClick={submit}>提交</Btn>
      </Page.Actions>
    </Page>
  );
}
