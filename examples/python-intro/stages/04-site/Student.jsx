import { useRef, useState } from 'react';
import { useStudentStage, Btn, Chip, Page, Fill } from '#kernel/client/index.js';
import { PyRunner, WebSim, buildRecord } from '@components/sandbox/index.js';
import { TASK, homeOk } from './stage.config.js';

const STAGE = 'site';
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
const isHome = (path) => String(path ?? '').split('?')[0] === '/';

export default function Student() {
  const { stage, isLive, myData, send } = useStudentStage(STAGE);
  const [code, setCode] = useState(stage?.sandbox?.starter ?? '');
  // 最近一次运行：{ code, result }。不接 onRestore：提交要求 app 在跑，刷新后命名空间已空，必须再运行一次
  const [last, setLast] = useState(null);
  const lastOk = useRef(false);
  // 首页状态码：模拟浏览器最近一次打开 / 的状态码（WebSim onResponse，跟随重定向后的状态）
  const [homeStatus, setHomeStatus] = useState(null);
  const runs = useRef(0);   // PyRunner 本实例运行次数
  const codeRef = useRef(code);
  codeRef.current = code;

  const onResult = (result, info) => {
    runs.current = info?.runs ?? runs.current;
    lastOk.current = !!result?.ok;
    setLast({ code: codeRef.current, result });
    // 新的运行让旧状态码作废：成功时等模拟浏览器自动刷新后由 onResponse 重新记录；
    // 报错或被停止时 app 仍是更早一次成功运行的，状态码会过时，保持 null
    setHomeStatus(null);
  };
  // 只认 GET 且最终落在 / 的导航（POST 表单重定向回首页不算）
  const onResponse = ({ status, method, finalPath }) => {
    if (lastOk.current && method === 'GET' && isHome(finalPath)) setHomeStatus(Number.isInteger(status) ? status : null);
  };
  const submit = () => {
    if (!last) return;
    const rec = buildRecord(last.result, { code: last.code, runs: runs.current });
    send('student:submit', { ...rec, homeStatus: last.result?.ok ? homeStatus : null });
  };

  const submitted = myData?.submittedAt != null;

  return (
    <Page template="split" title={TASK}>
      {/* 上下各半：Page.Main 本身是纵向 flex（带区域间距），两个 <Fill> 平分高度 */}
      <Page.Main>
        <Fill>
          <PyRunner
            stageId={STAGE}
            code={code}
            onChange={setCode}
            onResult={onResult}
          />
        </Fill>
        <Fill>
          <WebSim stageId={STAGE} home="/" onResponse={onResponse} />
        </Fill>
      </Page.Main>
      <Page.Actions>
        {submitted && (
          <Chip tone={myData.homeStatus == null || homeOk(myData.homeStatus) ? 'good' : 'warn'}>
            已提交 {fmtTime(myData.submittedAt)} · 首页 {myData.homeStatus ?? '未检查'}
          </Chip>
        )}
        <Btn variant="accent" disabled={!isLive || !last} onClick={submit}>提交</Btn>
      </Page.Actions>
    </Page>
  );
}
