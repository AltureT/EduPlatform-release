import { useRef, useState } from 'react';
import { useStudentStage, Btn, Chip, Page } from '#kernel/client/index.js';
import { PyRunner, buildRecord } from '@components/sandbox/index.js';
import { TASK } from './stage.config.js';

const STAGE = 'data';
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
// 编辑器补全里追加的 pandas / matplotlib 常用名（关键词、内置函数与文档内标识符由编辑器自带）
const EXTRA_COMPLETIONS = [
  'pd', 'plt', 'DataFrame', 'Series', 'read_csv', 'head', 'describe', 'mean', 'groupby', 'sort_values', 'columns',
  'plot', 'bar', 'show', 'figure', 'xlabel', 'ylabel', 'title', 'legend', 'savefig',
];

export default function Student() {
  const { stage, isLive, myData, send } = useStudentStage(STAGE);
  const [code, setCode] = useState(stage?.sandbox?.starter ?? '');
  const [last, setLast] = useState(null);   // 最近一次运行：{ code, result }（刷新后由 onRestore 恢复，图至多 1 张）
  const runs = useRef(0);                    // PyRunner 本实例运行次数
  const codeRef = useRef(code);
  codeRef.current = code;

  const onResult = (result, info) => {
    runs.current = info?.runs ?? runs.current;
    setLast({ code: codeRef.current, result });
  };
  const onRestore = ({ code: ranCode, result }) => {
    if (result.kind === 'run') setLast({ code: ranCode, result });
  };
  const submit = () => {
    if (!last) return;
    send('student:submit', buildRecord(last.result, { code: last.code, runs: runs.current }));
  };

  return (
    <Page template="split" title={TASK}>
      <Page.Main>
        <PyRunner
          stageId={STAGE}
          code={code}
          onChange={setCode}
          onResult={onResult}
          onRestore={onRestore}
          extraCompletions={EXTRA_COMPLETIONS}
        />
      </Page.Main>
      <Page.Actions>
        {myData?.submittedAt != null && (
          <Chip tone="good">已提交 {fmtTime(myData.submittedAt)} · {myData.images?.length ? '有图' : '无图'}</Chip>
        )}
        <Btn variant="accent" disabled={!isLive || !last} onClick={submit}>提交</Btn>
      </Page.Actions>
    </Page>
  );
}
