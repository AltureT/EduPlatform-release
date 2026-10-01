// check-in-worker.js 的 worker 入口：跑一次 checkLesson，把结果（纯数据）发回主线程
import { parentPort, workerData } from 'node:worker_threads';
import { checkLesson } from '../check-lesson.mjs';

try {
  const { configPath, root, componentsRoot, testsBudgetMs, tests } = workerData;
  const off = () => ({ available: false, reason: '这次检查没有验证代码题测试（Python 环境工作台会自动准备，没好时到 平台 → 环境与版本 看状态）' });
  const result = await checkLesson(configPath, {
    root, ...(componentsRoot ? { componentsRoot } : {}), testsBudgetMs, ...(tests === false ? { pyRunner: off } : {}),
  });
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, message: String(err?.message ?? err) });
}
