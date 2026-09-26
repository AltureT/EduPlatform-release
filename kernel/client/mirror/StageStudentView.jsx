// <StageStudentView stageId />（规格 v0.5 §2.4，公开导出）：按 id 渲染该阶段的 Student.jsx；
// 用与 StudentApp 相同的阶段注册表；prelogin / curtain / 未知阶段返回 null。
// v0.7：与学生外壳一样提供阶段信息，<Page> 不写 template 时取 stage.config.layout
import { getStageRegistry, BUILTIN_STAGE_IDS } from '../stores/stageStores.js';
import { PageStageContext } from '../layout/pageContext.js';

export default function StageStudentView({ stageId }) {
  if (BUILTIN_STAGE_IDS.includes(stageId)) return null;
  const entry = getStageRegistry().byId[stageId];
  const Comp = entry && entry.Student;
  if (!Comp) return null;
  return (
    <PageStageContext.Provider value={{ view: 'student', config: entry.config }}>
      <Comp />
    </PageStageContext.Provider>
  );
}
