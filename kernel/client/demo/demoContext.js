// 教师演示模式上下文（T9a，教师视图与学生页重排规格 §2.2）：{ stageId } | null，与 MirrorContext 同层。
// 教师外壳的演示视图渲染 <DemoProvider stageId><StageStudentView stageId /></DemoProvider>；
// 处于其中时 useStudentStage 返回 demo: true、本地演示记录 myData / setMyData、教师端 options 与班级记录，send 为 no-op
import { createContext } from 'react';

export const DemoContext = createContext(null);
