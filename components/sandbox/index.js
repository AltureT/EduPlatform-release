// sandbox 客户端公开入口 @components/sandbox/index.js（规格 §3.3）：只允许阶段的 .jsx 视图引用
// 模块顶层无副作用（不建 Worker、不发请求）
export { usePython } from './client/usePython.js';
export { buildRecord } from './client/buildRecord.js';
export { PyRunner, PyOutput, WebSim } from './client/ui/index.js';
// T9a（教师视图与学生页重排规格 §2.1）：教师端"Python 就绪 N / 在线 M"读数（统计视图摘要芯片用）
export { usePythonReady } from './client/slots/pythonReady.js';
