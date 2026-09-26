### 段 2 · 数据与图

> 核心教学事件：学生用 pandas 读一份成绩表，用 matplotlib 画出带中文标签的柱状图。

**A 展示**
- 大屏投什么：本段不设演示视图，教师端只显统计视图（是否出图、运行次数、报错、提交时间）；点行看该生的图
- 学生屏幕看什么：题目"读 scores.csv，画各科平均分柱状图（中文标签）"；代码编辑器（starter 已读入表格并打印前几行；补全含 `pd`、`plt`、`read_csv` 等常用名）与输出区（含图，按宽度缩放）撑满一屏 + 运行按钮行；`[提交]` 与提交后的"已提交 HH:MM:SS · 有图 / 无图"芯片在底部操作条
- 教师按什么按钮、在什么时点按：提交率够了按"下一段"（见 E）
- 教师是否需要看某个学生的实时画面 / 挑人上来讲：可镜像；统计视图点行看代码与图

**B 学生做什么**
- 动作是什么：改代码 → 运行出图 → 提交
- 有几步，步与步之间是否有先后：两步；至少运行过一次才能提交
- 提交后能不能改：能，以最后一次为准
- 做不对时平台给什么反馈：Python 报错 + 中文提示；未提供的包提示"本课未提供 X 包"；图过大时输出区提示"图片过大，未随记录保存"

**C 采集**
- 记什么字段：每人 `code`、`stdout`、`error`、`images`（≤ 1 张，降分辨率后的 PNG base64）、`runs`、`ms`、`submittedAt`
- 记到人、记到组、还是只记到班：到人
- 课后要不要回看 / 进个人报告：可回看（只读）；进个人报告

**D 统计**
- 教师统计视图看哪几列：姓名、出图（是 / 否）、运行次数、报错类型、提交时间；点行弹出代码 + 输出 + 图
- 什么情况要提醒教师走过去：进入本段 8 分钟未提交；提交了但没有图
- 要不要排行 / 推荐分享：不排行；无 `recommend` / `score`
- 报告条目（`summarize`）："是否出图"、"全班出图人数"

**E 推进条件**
- 教师按"下一段"时要满足：在线学生提交率 ≥ 70%
- 不满足时：软提示（一键继续 / 可强制推）

**匹配原语**：代码沙盒（`primitive: null`）

---

#### 实现要点

| 栏 | 文件 |
|---|---|
| A | `Student.jsx`：`<Page template="split" title={TASK}>`（`layout: 'split'`）；`Page.Main` 放 `<PyRunner stageId="data" onResult onRestore extraCompletions>`（不传 `height`），`Page.Actions` 放"已提交"芯片与 `[提交]`（刷新后按恢复的最近结果启用；恢复的结果至多带 1 张图）；无 `TeacherDemo.jsx` |
| B | `server.js`：`student:submit`（`recordShape`，图 ≤ 1 张）→ `data.set(name, { ...p, submittedAt })` |
| C | `stage.config.js`：`sandbox.packages: ['pandas', 'matplotlib']`、`sandbox.files['scores.csv']`（12 行虚构编号 S01–S12 的语文 / 数学 / 英语成绩）、`collect` |
| D | `TeacherStats.jsx`（`DataTable` + `DetailModal` 内 `<PyOutput record>`）；`alerts` 的 `idle` / `no-image`；`summarize` |
| E | `gate`，`soft: true` |

#### 限制说明

- `scores.csv` 进入本段时写入学生浏览器里的虚拟文件系统；文件内容会打进前端，学生能看到
- matplotlib 中文字体为 GB2312 子集，生僻字可能显示为方框
- `turtle` / `tkinter` / `pygame` 不可用；更大的数据集本课不提供
- 数据与题目不要出现、也不要引导学生输入真名
