// 规格 v0.5 §2.1：组件客户端发现。@components 为 Vite / vitest 别名，指向 <项目根>/components。
// C5（课程本地组件规格 §2）：另 glob @lesson-components（<课程目录>/components；课程没有组件目录时指向内核空目录），
// 两处合并成一张表（键是文件路径，注册表按目录名取 id；平台与课程组件不会重名——服务端加载器已拒绝）。
// 单独成文件，便于测试用 vi.mock 提供假模块。
const platform = import.meta.glob('@components/*/client.jsx', { eager: true });
const lesson = import.meta.glob('@lesson-components/*/client.jsx', { eager: true });

export function mergeComponentGlobs(...globs) {
  return Object.assign({}, ...globs);
}

export default mergeComponentGlobs(platform, lesson);
