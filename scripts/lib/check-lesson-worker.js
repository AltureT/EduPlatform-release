// check-in-worker.js 的 worker 入口：跑一次 checkLesson，把结果（纯数据）发回主线程
import { parentPort, workerData } from 'node:worker_threads';
import { checkLesson } from '../check-lesson.mjs';

try {
  const { configPath, root, componentsRoot, testsBudgetMs, tests } = workerData;
  const off = () => ({ available: false, reason: '这次检查没有验证代码题测试（工作台左边第 4 步"上课准备"可下载 Python 运行时）' });
  const result = await checkLesson(configPath, {
    root, ...(componentsRoot ? { componentsRoot } : {}), testsBudgetMs, ...(tests === false ? { pyRunner: off } : {}),
  });
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, message: String(err?.message ?? err) });
}
