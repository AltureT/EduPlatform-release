// 等宽字体栈（代码展示统一高亮规格 §2）：CodeView、sandbox 的 Editor / PyOutput / WebSim 等共用。
// 原在 components/sandbox/client/ui/mono.js（现改为从这里再导出）。值与令牌 --font-mono 相同：原语、自写段与 CodeView 写 var(--font-mono)，
// 这个常量只给 CodeMirror 主题等需要字面值的组件内部用
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
