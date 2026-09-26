// sandbox 代码沙盒组件：浏览器内 Python（Pyodide）+ 模拟 Web 服务器（代码沙盒组件规格 §3）
export default {
  id: 'sandbox',
  label: 'Python 沙盒',
  static: { '/pyodide': 'vendor/pyodide' },
  requires: [{ path: 'vendor/pyodide/manifest.json', hint: "请在管理台里点'下载 Python 运行时'（或运行 npm run fetch:pyodide）" }],
};
