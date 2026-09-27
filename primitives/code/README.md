# code · 程序题

一道 Python 编程题：学生在浏览器里写代码、点"运行"看输出，写了 `tests` 还能点"测试"用 pytest 自动判题。建在 sandbox 组件之上（`lesson.config.components` 必须打开 `sandbox`，否则启动失败）。学生页宽屏三栏：左边是标题为"题目"的面板，中间是代码（上方小标题"代码"），右边是输出（"输出"，测试后为"测试结果"：一行"通过 x / n"加每个用例一行 ✓ / ✗ 与失败原因，pytest 原文收在"查看详细输出 ▾"里）；两条分隔线都能拖动调宽度（本机记住，双击恢复；Main : Side 缺省 3 : 1）；窄屏时题目在上、可折叠。学生每次运行或测试结束，记录自动保存（以最后一次为准）；"上交最终稿"宽屏在题目面板底部、窄屏在底部操作条（确认后把当前代码和最近一次输出作为最终稿，可再次上交覆盖；代码在那次运行后改过时确认框会提醒，最终稿记 `stale`；回看 / 镜像时只显示上交状态）。回看这一段时（缺省 `reviewInteractive: true`，阶段写 `reviewInteractive: false` 可关）照样能滚动、勾要求、改代码、运行、测试，只是不记录、不能上交，操作条显示"回看 · 运行不记录"。测试结果面板的用例名去掉 `test_`（参数化写成 `param [1900-False]`，docstring 优先），失败原因取 pytest 标出的那条 assert，main.py 语法错时显示"测试文件加载失败"。教师统计页、推进门槛、8 分钟提醒、大屏（已运行 N/M、测试全过 N、最近报错 Top 3、投到大屏的一份代码、参考答案）、个人报告条目、分享推荐全部自动有。

写了 `solution` 时，教师在演示页除了"显示 / 隐藏参考答案"（只上大屏），还能点"公布参考答案给学生"（点两次才生效）：全班学生题目栏在要求清单之后出现"参考答案"面板（等宽代码，可"放大"看、可选中复制，不会自动填进编辑器）；已公布时按钮变成"撤回参考答案"，标题区提示"参考答案已公布 HH:MM"，撤回后面板消失。公布之后学生再运行 / 上交的记录带"答案公布后"标记，统计页"最近运行 / 已上交"两列后缀"（答案后）"，摘要多一个"答案公布后又运行 N 人"。

`starter` 写成数组（2–4 份）时，学生第一次进本段先看到"选一个起点"：每份一张卡片（名字 + 代码前 8 行，空代码显示"从空白开始"），点"用这份"才出现编辑器；之后操作条有"换起点"（确认后清掉现在写的代码、回到选择页，已保存的记录不受影响；回看时不显示）。选择记在学生浏览器里，刷新不丢；统计页行详情第一行"起点：框架版"，摘要"起点 框架版 N · 空白版 M"。

## options

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `prompt` | 字符串 1–4000 字 | 必填 | 题目正文，纯文本；空行分段，显示在学生页的"题目"面板 |
| `requirements` | 数组，≤ 10 条；每条是 1–200 字的字符串，或 `{ text: 1–200 字, hint: 1–600 字 }`（`hint` 可 `{ from }`） | 无 | 要求清单，学生逐条自己勾选（只是自检，不上交）；带 `hint` 的条目下有"提示 ▾"，展开是只读代码块（与 data-analysis 的 `tasks` 同一做法） |
| `starter` | 字符串或 `{ from: './starter.py' }`；或数组 `[{ label: 1–12 字, code: 字符串或 { from } }]`（2–4 份，`label` 不重复） | `if __name__ == '__main__':` 骨架 | 起始代码；数组时学生先选一份起点（见上），可"换起点" |
| `packages` | 包名数组 | `[]` | 本段要预载的包（须在 sandbox 白名单里，如 `pandas`、`matplotlib`） |
| `files` | `{ 路径: 文本 }`，值可 `{ from }` | 无 | 进入本段时写入学生的虚拟文件系统 |
| `tests` | `{ 'test_main.py': 文本 }`，值可 `{ from }` | 无 | pytest 测试；有了才显示"测试"按钮。学生代码存为 `main.py`，测试里写 `from main import 函数名`。**学生能看到测试内容** |
| `solution` | 字符串或 `{ from }` | 无 | 参考答案。**保密选项**：只发教师；教师在演示页点"显示参考答案"才上大屏，点"公布参考答案给学生"（两次确认）才发给全班，可撤回 |
| `gate` | 声明式门槛 | 有 tests：`{ testsPassed: 'all', soft: true }`；否则 `{ ran: 0.7, soft: true }` | 三种口径可选：`testsPassed`（测试全过）、`ran`（跑通）、`submitted`（上交了最终稿，如 `{ submitted: 0.7, soft: true }`）；也可 `false`；`testsPassed` 要先写 `tests` |
| `idleAlertMs` | 毫秒 | `480000`（8 分钟） | 进入本段多久还没通过测试（无 tests：没跑通）就提醒教师；`0` 不提醒 |

`{ from: './x' }` 相对阶段目录，只能引用阶段根目录里的文件。`starter`（数组写法每份都算）+ `tests` + `files` 合计 ≤ 200 KB（按 JSON 转义后的长度算，换行、引号等会多占字符；超了启动失败并写明 KB 数）——这些内容随课堂状态（`options` 与 `sandbox` 各一份）在学生连接、加入成功、课堂重置时下发，宜小。

门槛的三个指标：`ran`（跑通）＝至少跑过一次且最近一次没有报错；`testsPassed`（测试全过）＝记录里有 `firstPassedAt`，即某次测试 `failed + errors === 0` 且 `total > 0`——只记一次，之后再改代码不会掉出；`submitted`（已上交）＝记录里有 `finalAt`，即学生点过"上交最终稿"（自动保存的运行记录不算）。分母都是在线学生。

采集：每人一条 sandbox 记录 `{ code, stdout, error, images(≤ 1), tests, runs, ms, submittedAt, firstPassedAt?, final?, finalAt?, afterSolution?, starterLabel? }`（`submittedAt` 是最近一次运行的时间；`firstPassedAt` 是测试首次全过的时间，服务端只写一次；`tests` 带 `cases: [{ name, ok, reason }]`（≤ 50 条）；`final { code, stdout, error, images, tests, at }` 与 `finalAt` 是最终稿，事件 `student:code-final`，覆盖式写入，不动自动记录的字段）；`tests` 只对应测试时的那份代码，改了代码再运行就是 `null`。有 `solution` 时，参考答案公布中到达的运行记录写 `afterSolution: true`（其它情况不写；撤回后再运行，之前的标记仍保留），公布中上交的最终稿写 `final.afterSolution: true`；`starter` 为数组时两个学生事件都带 `starterLabel`（学生选的那份的名字，服务端只收 `starter` 里有的名字）。班级记录 `{ featured, showSolution?, solution?, solutionPublishedAt? }`：`featured` 是投到大屏的学生名，`showSolution` 只是大屏开关；参考答案正文只在教师点"公布参考答案给学生"时写进 `solution`（同时写 `solutionPublishedAt`），撤回即清为 `null`。

大屏与统计：统计页列 运行次数 / 最近报错 / 测试 通过/总数 / 已上交（时间）/ 最近运行，摘要多一个"已上交 N/M"；点行看两个标签"最终稿 / 最近运行"，行详情里"投到大屏"（大屏有最终稿时显示最终稿）；演示页的"取消展示"撤下。统计页与大屏的"测试全过 N"、门槛、提醒、推荐都按 `firstPassedAt`；表格的"测试"列显示最近一次。推荐分享：测试首次全过最早的 5 人（无 tests：跑通且最近一次记录最早）。大屏没有投屏时显示"尚未投屏"。报告：测试通过数 / 总数（无 tests：运行 N 次，最后一次有无报错）+ 我的代码（前 2000 字，report 组件按代码块显示：保留换行缩进、语法高亮）——有最终稿用最终稿，没有则取最近运行并标"（未上交，取最近运行）"。

模拟片段 `__tests__/simulate.js`：虚拟学生直接发一条"测试全过 / 无报错"的记录，再上交一次最终稿。

## 示例

```js
// stages/04-leap/stage.config.js
export default {
  id: 'leap',
  label: '闰年判断',
  primitive: 'code',
  options: {
    prompt: '写函数 is_leap(year)：是闰年返回 True，否则返回 False。',
    requirements: ['能被 4 整除的是闰年', { text: '整百年要能被 400 整除', hint: 'year % 400 == 0' }],
    starter: [{ label: '框架版', code: { from: './starter.py' } }, { label: '空白版', code: '' }],   // 只要一份就写 starter: { from: './starter.py' }
    tests: { 'test_main.py': { from: './tests/test_main.py' } },
    solution: { from: './solution.py' },
  },
};
```

目录里只要 `STAGE.md`、`stage.config.js` 和被引用的文件。`collect`、`subPhases`、`layout`、`sandbox` 由原语决定，不能写。

## 限制

- 测试文件随课堂状态发给学生，学生能看到测试内容（能照着断言写代码）；要防"对答案"就别放测试，改用 `{ ran }` 门槛由教师看代码。
- 公布参考答案后学生仍能编辑、运行、上交（不锁编辑器）；"（答案后）"标记只帮教师区分，不影响门槛与评分。
- 多份起始代码的选择只记在学生浏览器里（换设备会再问一次，已有记录的按记录里的 `starterLabel`）。
- 记录里的 `stdout`、`error`、`tests` 是学生浏览器算出来的，能被伪造；只作课堂进度参考，不要当考试分数。
- 题目与 starter 不要引导学生输入真名。
- 中文字体平台已内置，起始代码和提示里不用写 `font.sans-serif` / `SimHei` 之类的设置；写了也能显示，但多余。

## 什么时候不该用 code

- 要读一份表格数据画图 → 用 `data-analysis`。
- 要模拟网站（Flask + 模拟浏览器）、要一段里做几道题、要"测试全过才能提交" → 自写阶段（`primitive: null`），参考 `examples/python-intro`。
