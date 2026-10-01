// data-analysis 教师统计视图：共用骨架 CodeStats（mode data：加"已出图"列与芯片）；
// 行详情里"投到大屏"发 teacher:feature { name }，统计视图摘要区（Summary.jsx，T9a：原演示视图主体）显示该生的图与代码。
// T9a（教师视图与学生页重排规格 §2.1）：本段是当前段且有 sandbox 配置时摘要芯片多一枚"Python 就绪 N/M"（sandbox 的 usePythonReady）。
import { useTeacherStage } from '#kernel/client/index.js';
import { usePythonReady } from '@components/sandbox/index.js';
import CodeStats from '../_shared/CodeStats.jsx';
import Summary from './Summary.jsx';

export default function TeacherStats({ stageId } = {}) {
  const { stage, send, isLive } = useTeacherStage(stageId);
  const id = stageId ?? stage?.id;
  const py = usePythonReady(id);
  return (
    <CodeStats
      stageId={id}
      mode="data"
      onFeature={(name) => send('teacher:feature', { name })}
      python={isLive && py?.hasConfig ? py : null}
      summaryBlock={<Summary stageId={id} />}
    />
  );
}
