// sandbox 代码沙盒组件：浏览器内 Python（Pyodide）+ 模拟 Web 服务器（代码沙盒组件规格 §3）
export default {
  id: 'sandbox',
  label: 'Python 沙盒',
  static: { '/pyodide': 'vendor/pyodide' },
  requires: [{ path: 'vendor/pyodide/manifest.json', hint: 'Python 环境会自动准备，没好时到 平台 → 环境与版本 看状态' }],
};
