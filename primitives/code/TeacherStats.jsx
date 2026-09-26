// code 教师统计视图：共用骨架 CodeStats（mode code；有 tests 时加"测试 通过/总数"列与"测试全过"芯片）；
// 行详情里"投到大屏"发 teacher:feature { name }，大屏（TeacherDemo）显示该生的代码与输出。
import { useTeacherStage } from '#kernel/client/index.js';
import CodeStats from '../_shared/CodeStats.jsx';
import { hasTestsIn } from './record.js';

export default function TeacherStats({ stageId } = {}) {
  const { stage, options, send } = useTeacherStage(stageId);
  const id = stageId ?? stage?.id;
  return (
    <CodeStats
      stageId={id}
      mode="code"
      hasTests={hasTestsIn(options)}
      onFeature={(name) => send('teacher:feature', { name })}
    />
  );
}
