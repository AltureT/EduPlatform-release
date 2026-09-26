// 规格 §4：阶段发现。@stages 为 Vite 别名，指向 STAGES_ROOT；不以 / 开头，走别名解析。
// 单独成文件，便于测试用 vi.mock 提供假模块。
const modules = import.meta.glob(
  '@stages/*/{stage.config.js,Student.jsx,TeacherDemo.jsx,TeacherStats.jsx,store.js}',
  { eager: true },
);

// v0.8（活动原语规格 §2.3）：原语的配置与默认视图。@primitives → <项目根>/primitives
export const primitiveGlob = import.meta.glob(
  '@primitives/*/{primitive.config.js,Student.jsx,TeacherDemo.jsx,TeacherStats.jsx}',
  { eager: true },
);

export default modules;
