// data-analysis 教师统计视图：共用骨架 CodeStats（mode data：加"已出图"列与芯片）；
// 行详情里"投到大屏"发 teacher:feature { name }，大屏（TeacherDemo）显示该生的图与代码。
import { useTeacherStage } from '#kernel/client/index.js';
import CodeStats from '../_shared/CodeStats.jsx';

export default function TeacherStats({ stageId } = {}) {
  const { stage, send } = useTeacherStage(stageId);
  const id = stageId ?? stage?.id;
  return <CodeStats stageId={id} mode="data" onFeature={(name) => send('teacher:feature', { name })} />;
}
