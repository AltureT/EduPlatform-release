// code 教师统计视图：共用骨架 CodeStats（mode code；有 tests 时加"测试 通过/总数"列与"测试全过"芯片）；
// 行详情里"投到大屏"发 teacher:feature { name }，大屏（TeacherDemo）显示该生的代码与输出。
// P6：多份起始代码（options.starters）时把各份 label 交给 CodeStats（行详情"起点：…"、摘要"起点 框架版 N · 空白版 M"）。
// V2：有错误库（options.mistakes，保密选项，只在教师端）时交给 CodeStats（列"错误类型"、摘要"错误分类"、行详情"老师预判"）。
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
      starters={Array.isArray(options?.starters) ? options.starters.map((s) => s.label) : undefined}
      mistakes={options?.mistakes}
      onFeature={(name) => send('teacher:feature', { name })}
    />
  );
}
