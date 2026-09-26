// 规格 v0.5 §2.1：组件客户端发现。@components 为 Vite / vitest 别名，指向 <项目根>/components。
// 单独成文件，便于测试用 vi.mock 提供假模块。
const modules = import.meta.glob('@components/*/client.jsx', { eager: true });

export default modules;
