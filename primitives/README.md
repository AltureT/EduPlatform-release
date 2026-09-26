# primitives/

活动原语：带默认视图、事件处理、采集、门槛、提醒与报告条目的"阶段半成品"。阶段在 `stage.config.js` 里写 `primitive: '<type>'` 与 `options` 选用，目录里只要 `STAGE.md` + `stage.config.js`。合并与覆盖规则见《阶段模块契约》§五（v0.8），机制见《活动原语规格》§2，一期清单见其 §3。

| 原语 | 用途 | 用法 |
|---|---|---|
| `vote` | 一题单选 / 多选，全班分布上大屏，可揭晓答案 | [vote/README.md](vote/README.md) |
| `quiz` | 多题（单选 / 判断 / 填空）顺序作答、自动判分，结果提交即看 / 揭晓后看 / 不给看 | [quiz/README.md](quiz/README.md) |
| `free-text` | 一到三道开放题短文作答，教师挑一份投到大屏 | [free-text/README.md](free-text/README.md) |
| `code` | 一道 Python 程序题，浏览器里写、跑、测（pytest 自动判题），需打开 sandbox 组件 | [code/README.md](code/README.md) |
| `data-analysis` | 给一份 CSV，用 pandas / matplotlib 看数据、算、画图，需打开 sandbox 组件 | [data-analysis/README.md](data-analysis/README.md) |

`_shared/` 是原语作者用的共享件（声明式门槛、统计页骨架、code / data-analysis 共用的 `CodeStats`），阶段不要引用。可运行的范本：`examples/primitives-tour`。

写配置时注意：

- `stage.config.js` 的默认导出必须是对象字面量（或同文件顶层 `const` 对象字面量再 `export default cfg`），顶层不用展开和计算属性名——前端打包时内核插件要把 `options` 删掉，写法删不掉会构建失败；`options` 里的文字也不要再经别的导出给视图用。
- `options` 里的 `{ from: './x' }` 只能引用**阶段根目录**（`lesson.config.stagesDir`）里的文件，按真实路径判断，软链指到外面也不行；课程根的 `.env`、`data/` 都不在其中。几段共用的文件放阶段根目录的子目录，如 `stages/_shared/`，再写 `{ from: '../_shared/scores.csv' }`。
