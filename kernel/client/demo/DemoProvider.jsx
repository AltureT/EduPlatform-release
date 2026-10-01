// <DemoProvider stageId>…</DemoProvider>（T9a，教师视图与学生页重排规格 §2.2；外壳内部件，不经公开入口导出）：
// 教师外壳的演示视图用它包住 <StageStudentView stageId />——里面的 useStudentStage 进入教师演示模式（见 hooks/useStage.js）。
// 不加 inert（与镜像不同）：教师可以点选、提交、运行，但一律只写本地演示记录，不发事件
import { useMemo } from 'react';
import { DemoContext } from './demoContext.js';

export default function DemoProvider({ stageId, children }) {
  const value = useMemo(() => ({ stageId }), [stageId]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
