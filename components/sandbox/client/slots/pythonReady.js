// T9a（教师视图与学生页重排规格 §2.1）：教师端"Python 就绪 N / 在线 M"的读数（原 teacherToolbar 芯片）
//   usePythonReady(stageId?) → { stageId, hasConfig, online, ready, notReady, errored, top }
//   stageId 缺省 = 教师端当前阶段（useComponent().currentStage）；prelogin 与无 sandbox 配置的阶段计 ready ∈ { core, stage }，
//   有配置的阶段只计 stage；数据来自组件数据 perStudent[name][stageId]（学生端 studentOverlay 发的 sandbox:s-status）
// 用处：课前页一行（teacherPrelogin 槽位）、code / data-analysis 统计视图摘要芯片（经 @components/sandbox/index.js）。只在教师端有意义
import { useComponent, useTeacherStage } from '#kernel/client/index.js';
import { useSandboxConfig } from '../stageConfig.js';
import { toolbarStats } from './TeacherToolbar.jsx';

export function usePythonReady(stageId) {
  const c = useComponent('sandbox');
  const id = stageId ?? c.currentStage?.id ?? null;
  const { roster } = useTeacherStage(id);
  const cfg = useSandboxConfig(id);
  const hasConfig = !!(id && c.isEnabledFor(id) && cfg);
  return { stageId: id, hasConfig, ...toolbarStats({ roster, perStudent: c.data?.perStudent, stageId: id, hasConfig }) };
}
