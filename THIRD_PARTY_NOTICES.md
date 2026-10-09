# 第三方组件声明 · Third-Party Notices

班迹本身按 MIT 授权（见 LICENSE），文档按 CC BY 4.0（见 LICENSE-docs）。下面这些第三方组件随平台使用或分发，各自保留原许可。

## Python 运行时整包（EduPlatform-runtime-v*.zip，解压到 vendor/pyodide/）

| 组件 | 许可 | 源码 / 许可全文 |
|---|---|---|
| Pyodide（pyodide.mjs、pyodide.asm.*、pyodide-lock*.json） | MPL-2.0 | https://github.com/pyodide/pyodide |
| CPython（编进 pyodide.asm.wasm，标准库 python_stdlib.zip） | PSF-2.0 | https://github.com/python/cpython |
| Noto Sans SC（fonts/NotoSansSC-subset.otf，按课程用字裁剪的子集） | SIL OFL 1.1 | https://github.com/notofonts/noto-cjk ，许可全文 https://openfontlicense.org |
| micropip | MPL-2.0 | https://github.com/pyodide/micropip |
| numpy、pandas、contourpy、kiwisolver、cycler、jinja2、markupsafe、flask、werkzeug、click、itsdangerous、blinker | BSD-3-Clause | 各项目主页 |
| pygments | BSD-2-Clause | https://github.com/pygments/pygments |
| matplotlib | Matplotlib License（PSF 式） | https://github.com/matplotlib/matplotlib |
| pillow | MIT-CMU | https://github.com/python-pillow/Pillow |
| python-dateutil | Apache-2.0 / BSD-3-Clause 双许可 | https://github.com/dateutil/dateutil |
| packaging | Apache-2.0 / BSD-2-Clause 双许可 | https://github.com/pypa/packaging |
| pytest、pluggy、iniconfig、py、attrs、atomicwrites、exceptiongroup、more_itertools、fonttools、pyparsing、pytz、six、setuptools | MIT | 各项目主页 |

每个 .whl 里的 `*.dist-info/` 带有该包的完整许可文本，以其为准。

## 教师机上自动下载、不随本仓库分发的

- Node.js（MIT 等，https://github.com/nodejs/node）：双击入口第一次运行时从 Node 官方或国内镜像下载。
- npm 依赖（React、Express、socket.io、CodeMirror、better-sqlite3、exceljs、zustand 等，均为 MIT 或同类宽松许可）：安装时从 npm 源下载，许可见各包 `node_modules/<包名>/` 下的 LICENSE。
