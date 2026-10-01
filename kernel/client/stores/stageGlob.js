// 规格 §4：阶段发现。@stages 为 Vite 别名，指向 STAGES_ROOT；不以 / 开头，走别名解析。
// 单独成文件，便于测试用 vi.mock 提供假模块。
const modules = import.meta.glob(
  '@stages/*/{stage.config.js,Student.jsx,TeacherDemo.jsx,TeacherStats.jsx,TeacherActions.jsx,store.js}',
  { eager: true },
);

// v0.8（活动原语规格 §2.3）：原语的配置与默认视图。@primitives → <项目根>/primitives
// T9a（教师视图与学生页重排规格 §2.2）：两处都加 TeacherActions.jsx（教师操作条按钮，可选）；TeacherDemo.jsx 只剩旧式（阶段目录自带），原语不再提供
export const primitiveGlob = import.meta.glob(
  '@primitives/*/{primitive.config.js,Student.jsx,TeacherDemo.jsx,TeacherStats.jsx,TeacherActions.jsx}',
  { eager: true },
);

export default modules;
