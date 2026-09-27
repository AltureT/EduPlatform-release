// 等宽字体栈：Editor / PyOutput / WebSim 共用。独立成模块，PyOutput 与 WebSim 不必为一个常量引入编辑器（为以后 React.lazy 拆包 CodeMirror 做准备）
// U6（代码展示统一高亮规格 §2）：常量移到内核 kernel/client/ui/mono.js（CodeView 也用），这里再导出
export { MONO } from '#kernel/client/ui/mono.js';
