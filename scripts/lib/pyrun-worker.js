// pyrun-node.js 的 worker 入口：在独立线程里起 Pyodide（只从本地目录，不出网），按消息跑测试 / 生成变体
//   { id, type: 'init', indexURL } → { id, ok, result: { ms } }
//   { id, type: 'tests', code, tests, files } → { id, ok, result: { junit } }
//   { id, type: 'mutants', source, max, includeMain } → { id, ok, result: [{ id, line, desc, code }] }
//   { id, type: 'eval', code, case, files } → { id, ok, result: { ok, repr? , error? } }（代码题批改规格 §3.2）
//   { id, type: 'reset' } → { id, ok }（清空工作目录）
// 失败 → { id, ok: false, message }
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { PYRUN_PY, pyodideLoadOptions } from './pyrun-node.js';

// 不出网：任何 http(s) 请求直接失败（loadPackage 若去外网取包，init 就失败，运行器变成不可用）
const realFetch = globalThis.fetch;
globalThis.fetch = (url, ...rest) => {
  const s = String(url?.url ?? url);
  if (/^https?:/i.test(s)) return Promise.reject(new Error(`不允许联网：${s}`));
  return realFetch(url, ...rest);
};

let py = null;

async function init(indexURL) {
  const t0 = Date.now();
  const opts = pyodideLoadOptions(indexURL); // Windows：正斜杠 + 显式 packageBaseUrl（pyrun-node.js 注释）
  const { loadPyodide } = await import(pathToFileURL(`${opts.indexURL}pyodide.mjs`).href);
  py = await loadPyodide({ ...opts, stdout: () => {}, stderr: () => {} });
  py.setStdin({ error: true }); // 测试里没喂 input() 就报错，不挂住
  await py.loadPackage(['pytest'], { messageCallback: () => {}, errorCallback: () => {} });
  py.runPython(PYRUN_PY);
  return { ms: Date.now() - t0 };
}

parentPort.on('message', async (m) => {
  try {
    let result;
    if (m.type === 'init') result = await init(m.indexURL);
    else if (m.type === 'tests') {
      const fn = py.globals.get('pyrun_tests');
      try {
        result = { junit: fn(m.code, JSON.stringify(m.tests ?? {}), JSON.stringify(m.files ?? {})) };
      } finally {
        fn.destroy();
      }
    } else if (m.type === 'mutants') {
      const fn = py.globals.get('pyrun_mutants');
      try {
        result = JSON.parse(fn(m.source, m.max, Boolean(m.includeMain)));
      } finally {
        fn.destroy();
      }
    } else if (m.type === 'eval') {
      const fn = py.globals.get('pyrun_eval');
      try {
        result = JSON.parse(fn(m.code, JSON.stringify(m.case ?? {}), JSON.stringify(m.files ?? {})));
      } finally {
        fn.destroy();
      }
    } else if (m.type === 'reset') {
      py.runPython('pyrun_reset()');
      result = null;
    } else throw new Error(`未知消息 ${m.type}`);
    parentPort.postMessage({ id: m.id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id: m.id, ok: false, message: String(err?.message ?? err) });
  }
});
