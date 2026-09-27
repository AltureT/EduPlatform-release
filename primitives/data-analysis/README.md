# data-analysis · 数据分析

给学生一份 CSV，学生用 pandas / matplotlib 看数据、算、画图；重点是"看数据、算、画"，不判对错。建在 sandbox 组件之上（`lesson.config.components` 必须打开 `sandbox`，并建议 lesson 级预载 `pandas`、`matplotlib`）。数据集在进入本段时写进学生浏览器里的虚拟文件系统；学生页宽屏三栏，左栏（Main : Side = 2 : 1，窄屏时在上、可折叠）自上而下是"题目"面板（题目、"画的图会显示在输出区"、任务清单，完整显示）、紧凑数据卡"数据 · 共 N 行 · M 列"（列名与前 3 行；"查看全部数据"打开全屏弹层：筛选框 + 可点列头排序的表格，超过 500 行只显示前 500 行）与贴在底部的"上交最终稿"（窄屏在底部操作条），中间是代码编辑器、右边是输出（含图）；两条分隔线都能拖动调宽度（本机记住，双击恢复）。回看这一段时（缺省 `reviewInteractive: true`，阶段写 false 可关）照样能滚动、看全部数据、改代码、运行，只是不记录、不能上交，操作条显示"回看 · 运行不记录"。每次运行结束记录自动保存（以最后一次为准，图 ≤ 1 张）；"上交最终稿"把当前代码和最近一次输出（含图）作为最终稿，可再次上交覆盖。教师统计页、推进门槛（出图比例）、8 分钟提醒、大屏（已运行 N/M、已出图 N、轮换展示学生的图、参考答案）、个人报告条目、分享推荐全部自动有。

写了 `solution`（参考答案）时，演示页多两个按钮：`显示 / 隐藏参考答案`（只上大屏，同 code）与`公布参考答案给学生`（点两次才生效）——公布后全班学生题目栏在任务清单之后出现"参考答案"面板（等宽代码，可"放大"、可选中复制），按钮变"撤回参考答案"，标题区提示"参考答案已公布 HH:MM"；公布之后再运行 / 上交的记录带"答案公布后"标记，统计页两列后缀"（答案后）"，摘要多"答案公布后又运行 N 人"。

## options

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `prompt` | 字符串 1–4000 字 | 必填 | 题目正文，纯文本；空行分段 |
| `dataset` | `{ path, from }` 或 `{ path, content }` | 必填 | 一份数据：`path` 是学生代码里读的路径（相对，如 `'data/scores.csv'`），`from` 是阶段目录里的文件（`.csv`，或 Excel `.xlsx`——此时 `path` 须以 `.csv` 结尾），也可直接写 `content` 文本；≤ 200 KB（转义后） |
| `tasks` | ≤ 8 条，每条是字符串或 `{ text, hint }` | `[]` | 任务清单（如"算各科平均分"），学生自己勾选，不上交；`hint` 是一段代码（≤ 2000 字），学生页任务下"提示 ▾"展开成只读代码块 |
| `starter` | 字符串或 `{ from }` | 读入该 CSV、`print(df.head())`，末尾附注释掉的画图示例 | 起始代码 |
| `packages` | 包名数组 | `['pandas', 'matplotlib']` | 本段预载的包 |
| `solution` | 字符串 1–20000 字或 `{ from }` | 无 | 参考答案。**保密选项**：只发教师；大屏可显示 / 隐藏，可公布给学生（两次确认）并撤回 |
| `expectImage` | 布尔 | `true` | 门槛、提醒、推荐按"是否出图"算；`false` 时按"跑通"（跑过且最近一次无报错）算 |
| `gate` | 声明式门槛 | `{ image: 0.7, soft: true }`；`expectImage: false` 时 `{ ran: 0.7, soft: true }` | 三种口径可选：`image`（出过图）、`ran`（跑通）、`submitted`（上交了最终稿，如 `{ submitted: 0.7, soft: true }`）；也可 `false` |
| `idleAlertMs` | 毫秒 | `480000`（8 分钟） | 进入本段多久还没出图（或没跑通）就提醒教师；`0` 不提醒 |

`dataset` 带 `path` 与 `from` 两个键，加载器不替它读文件，由原语在 `normalize` 里用 `readFrom` 读——路径限制同 `{ from }`：只能引用阶段根目录里的文件。数据集 ≤ 200 KB（按 JSON 转义后的长度算，换行、引号等会多占字符；超了启动失败，报"数据集经转义后 N KB，超过 200 KB，请精简行数"）。几段共用的数据放 `stages/_shared/`，写 `from: '../_shared/scores.csv'`。加载后 `options.dataset` 只剩元数据 `{ path, rows, columns }`（行数、列名），数据内容放在仅服务端选项 `$server.content`（不随 options 下发），只经 `sandbox.files[path]` 下发一份，学生页的表格从那里解析（`csv.js`：只处理逗号分隔与双引号转义）。`preview` 已删除（学生页显示全部数据；写了启动失败并提示）。

缺省 starter 末尾的画图示例按数据推断：首列作索引、数值列求平均画柱状图（如 `# df.set_index('编号')[['语文', '数学', '英语']].mean().plot(kind='bar', title='各列平均值')`、`# plt.show()`），没有数值列时画首列各值的个数；matplotlib 已预载，`plt.show()` 的图显示在输出区。

**教师给 Excel 也行，学生看到的是 CSV**：`dataset: { path: 'data/scores.csv', from: './data/scores.xlsx' }`——加载时取第一个工作表，首行为列名，空单元格为空串，日期写成 `YYYY-MM-DD`，数字原样，公式取计算结果，转成 CSV 写进 `path`（`path` 须以 `.csv` 结尾；xlsx 文件本身 ≤ 256 KB，转出的 CSV ≤ 200 KB）。

采集：每人一条 sandbox 记录 `{ code, stdout, error, images(≤ 1), tests: null, runs, ms, submittedAt, firstImageAt?, final?, finalAt?, afterSolution? }`（`firstImageAt` 是首次出图的时间，服务端只写一次；`final { code, stdout, error, images, tests, at }` 与 `finalAt` 是最终稿，事件 `student:data-final`，覆盖式写入；有 `solution` 时，参考答案公布中到达的运行记录写 `afterSolution: true`——其它情况不写，撤回后之前的标记仍保留——公布中上交的最终稿写 `final.afterSolution: true`）；班级记录 `{ featured, showSolution?, solution?, solutionPublishedAt? }`（`featured` 投到大屏的学生名；`showSolution` 大屏开关；参考答案正文只在公布时写进 `solution` 并记 `solutionPublishedAt`，撤回即清为 `null`）。

大屏与统计：统计页列 运行次数 / 已出图 / 最近报错 / 已上交 / 最近运行，摘要多"已上交 N/M"；点行看"最终稿 / 最近运行"两个标签（代码、输出与图），行详情里"投到大屏"（大屏有最终稿时显示最终稿的图）；演示页"换一份展示"在出过图的学生里按首次出图（`firstImageAt`）先后轮换，"取消展示"撤下，没有投屏时显示"尚未投屏"。"已出图 N"芯片、门槛、提醒、推荐都按 `firstImageAt`（学生之后改代码没图了也不会掉出，也不打乱轮换）；表格的"已出图"列显示最近一次。推荐分享：首次出图最早的 5 人。评分（share 自动互助用）：出图 1、跑过 0.5、没跑 0。报告：我的图（report 组件只显示文字"已出图（1 张）"，不显示图本身；有最终稿按最终稿，没有则取最近运行并标"（未上交，取最近运行）"）、运行次数。

模拟片段 `__tests__/simulate.js`：虚拟学生直接发一条带 1×1 PNG 的记录（每 10 人 1 人无图），再上交一次最终稿。

## 示例

```js
// stages/05-scores/stage.config.js
export default {
  id: 'scores',
  label: '成绩分析',
  primitive: 'data-analysis',
  options: {
    prompt: '这是一个班 12 个人的语文、数学、英语成绩。',
    dataset: { path: 'data/scores.csv', from: './data/scores.csv' },
    tasks: [
      '算各科平均分',
      { text: '画各科平均分的柱状图（中文标签）', hint: "avg = df[['语文', '数学', '英语']].mean()\navg.plot(kind='bar', title='各科平均分')\nplt.show()" },
    ],
  },
};
```

目录里只要 `STAGE.md`、`stage.config.js` 和数据文件。`collect`、`subPhases`、`layout`、`sandbox` 由原语决定，不能写。

## 限制

- 数据随课堂状态发给学生（学生页要预览、代码要读），学生能看到全部内容；数据里不要有真名。
- 数据随课堂状态（`sandbox.files`，一份）在学生连接、加入成功、课堂重置时下发；数据集尽量控制在几十 KB。学生页表格最多渲染 500 行，全部数据用代码读。
- matplotlib 中文字体是 GB2312 子集，生僻字可能显示成方框；图过大时只保存降分辨率后的版本，再大就不随记录保存（学生输出区有提示）。
- 中文字体平台已内置，起始代码和提示里不用写 `font.sans-serif` / `SimHei` 之类的设置；写了也能显示，但多余。
- 只有一份数据集；要多份或要判题 → 用 `code`（`files` + `tests`）。
