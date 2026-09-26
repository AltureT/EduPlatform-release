// check-in-worker.js 的 worker 入口：跑一次 checkLesson，把结果（纯数据）发回主线程
import { parentPort, workerData } from 'node:worker_threads';
import { checkLesson } from '../check-lesson.mjs';

try {
  const { configPath, root, componentsRoot } = workerData;
  const result = await checkLesson(configPath, { root, ...(componentsRoot ? { componentsRoot } : {}) });
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, message: String(err?.message ?? err) });
}
