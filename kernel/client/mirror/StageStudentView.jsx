// <StageStudentView stageId />（规格 v0.5 §2.4，公开导出）：按 id 渲染该阶段的 Student.jsx；
// 用与 StudentApp 相同的阶段注册表；prelogin / curtain / 未知阶段返回 null。
// v0.7：与学生外壳一样提供阶段信息，<Page> 不写 template 时取 stage.config.layout
// C5：isLive（studentAside 槽位的 props）= stageId 是否为本端 core store 的当前阶段（与镜像内 useStudentStage 的 isLive 同一判定）
// T9a：处于教师演示模式（DemoContext）时阶段信息另带 demo: true 与 lessonId（教师 store 的 lesson.id，<Page resizable> 拖宽记忆与学生端同键）
import { getStageRegistry, BUILTIN_STAGE_IDS } from '../stores/stageStores.js';
import { PageStageContext } from '../layout/pageContext.js';
import { coreStudentStore } from '../stores/coreStudentStore.js';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import { useKernelRole } from '../hooks/roleContext.js';
import { DemoContext } from '../demo/demoContext.js';
import { useContext } from 'react';

export default function StageStudentView({ stageId }) {
  const role = useKernelRole();
  const studentStage = coreStudentStore((s) => s.stage);
  const teacherStage = coreTeacherStore((s) => s.stage);
  const teacherLessonId = coreTeacherStore((s) => s.lesson && s.lesson.id);
  const demo = useContext(DemoContext);
  if (BUILTIN_STAGE_IDS.includes(stageId)) return null;
  const entry = getStageRegistry().byId[stageId];
  const Comp = entry && entry.Student;
  if (!Comp) return null;
  const isLive = stageId === (role === 'teacher' ? teacherStage : studentStage);
  return (
    <PageStageContext.Provider value={demo ? { view: 'student', demo: true, config: entry.config, isLive, lessonId: teacherLessonId } : { view: 'student', config: entry.config, isLive }}>
      <Comp />
    </PageStageContext.Provider>
  );
}
