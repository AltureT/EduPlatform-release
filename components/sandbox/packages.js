// sandbox 包白名单与运行时常量（规格 §3.1、§2.3）【Node 可用，无副作用】
// PACKAGES = scripts/fetch-pyodide.mjs 的 PACKAGES 及其依赖闭包的包名（= 裁剪版 pyodide-lock.json 的 packages 键；
// 服务端在 CI 里没有 vendor，不读 lock，所以抄成常量；真 Pyodide 冒烟断言两者一致）
// Flask 不在这里：它由 flask: true 单独控制，轮子见 FLASK_WHEELS

export const PYODIDE_VERSION = '314.0.7';

export const PACKAGES = Object.freeze([
  'atomicwrites',
  'attrs',
  'contourpy',
  'cycler',
  'exceptiongroup',
  'fonttools',
  'iniconfig',
  'jinja2',
  'kiwisolver',
  'markupsafe',
  'matplotlib',
  'micropip',
  'more-itertools',
  'numpy',
  'packaging',
  'pandas',
  'pillow',
  'pluggy',
  'py',
  'pygments',
  'pyparsing',
  'pytest',
  'python-dateutil',
  'pytz',
  'setuptools',
  'six',
]);

// vendor/pyodide/v<ver>/wheels/ 下的 Flask 及依赖（= fetch-pyodide.mjs 的 PYPI 常量）；jinja2 / markupsafe 用发行包里的
export const FLASK_WHEELS = Object.freeze([
  'flask-3.1.3-py3-none-any.whl',
  'werkzeug-3.1.8-py3-none-any.whl',
  'itsdangerous-2.2.0-py3-none-any.whl',
  'click-8.5.0-py3-none-any.whl',
  'blinker-1.9.0-py3-none-any.whl',
]);
export const FLASK_DEPS = Object.freeze(['jinja2', 'markupsafe']);

// Python 的 import 名（与包名不同的几项）→ 用于 friendlyError 判断"是不是白名单里的包"
export const IMPORT_NAMES = Object.freeze([
  ...PACKAGES.filter((p) => !['pillow', 'python-dateutil', 'more-itertools'].includes(p)),
  'PIL', 'dateutil', 'more_itertools', 'mpl_toolkits', 'pylab', '_pytest',
]);

export const FONT_PATH = 'fonts/NotoSansSC-subset.otf';
