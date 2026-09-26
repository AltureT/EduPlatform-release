// 在 worker 线程里跑 check:lesson（L1）：同一进程、不另起子进程，但模块缓存是新的——
// 课程文件改过之后再查，读到的是改后的内容（主线程里 import 过的 stage.config.js 会被缓存，内核加载器不带缓存参数）。
//   checkLessonInWorker(configPath, { root, componentsRoot?, timeoutMs, onWorker? }) → Promise<{ ok, errors, warnings, lesson }>；
//   校验器自身出错或超时则 reject（调用方决定是否放行）；超时时先 terminate 该 worker 再 reject
import { Worker } from 'node:worker_threads';

const WORKER = new URL('./check-lesson-worker.js', import.meta.url);

export function checkLessonInWorker(configPath, { root = process.cwd(), componentsRoot, timeoutMs = 60_000, onWorker } = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, { workerData: { configPath, root, componentsRoot } });
    onWorker?.(w); // 测试用：拿到 worker 以确认超时后已结束
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => {
      w.terminate();
      const t = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} 秒` : `${timeoutMs} 毫秒`;
      done(reject, new Error(`课程检查超过 ${t} 没有完成`));
    }, timeoutMs);
    w.once('message', (m) => {
      if (m?.ok) done(resolve, m.result);
      else done(reject, new Error(m?.message ?? '课程检查没能完成'));
      w.terminate();
    });
    w.once('error', (err) => done(reject, err));
    w.once('exit', (code) => done(reject, new Error(`课程检查意外结束（${code}）`)));
  });
}
