// sandbox Worker 入口（规格 §3.8）：只做 self.onmessage → core.handle(msg)
// 由 pythonClient.js 以 new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }) 创建，Vite 打成独立 chunk
import { createWorkerCore } from './workerCore.js';

const core = createWorkerCore({
  post: (m) => self.postMessage(m),
  xhrFactory: () => new XMLHttpRequest(),
});

self.onmessage = (e) => {
  core.handle(e.data);
};
