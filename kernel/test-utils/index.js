// 【公开入口】规格 §2 / 契约 §一（v0.5 增加 mockCctx、renderWithKernel）
export { mockCtx } from './mockCtx.js';
export { mockCctx } from './mockCctx.js';
export { mockIo } from './mockIo.js';
export { mockSocket } from './mockSocket.js';
export { memDb } from './memDb.js';
export { spawnServer } from './spawnServer.js';
export { waitFor, waitForMatching } from './waitFor.js';
export { teacherToken } from './teacherToken.js';
export { virtualStudent } from './virtualStudent.js';
export { virtualTeacher } from './virtualTeacher.js';

// renderWithKernel(ui, opts) → { emit, store, sent }（规格 v0.5 §2.7，sent 见规格 v0.3.1）只在 vitest（jsdom）里可用。
// 服务端（node --test）import 本文件时不得加载 React / 客户端 store：
// 仅当存在 document 时才动态 import ./renderWithKernel.jsx（顶层 await），否则调用即抛错。
let renderImpl = null;
if (typeof document !== 'undefined') {
  ({ renderWithKernel: renderImpl } = await import('./renderWithKernel.jsx'));
}
export function renderWithKernel(ui, opts) {
  if (!renderImpl) throw new Error('renderWithKernel 只能在 vitest（jsdom 环境）中使用');
  return renderImpl(ui, opts);
}
