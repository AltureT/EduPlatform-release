### 段 1 · 第一段代码

> 核心教学事件：学生第一次在自己的平板上写 Python、按运行、看到输出或报错。

**A 展示**
- 大屏投什么：本段不设演示视图，教师端只显统计视图（全班运行次数、报错类型、提交时间）；需要时用镜像投某个学生的代码与输出
- 学生屏幕看什么：题目"打印九九乘法表前三行"；代码编辑器与输出区左右（窄屏上下）撑满一屏，下方 `[▶ 运行] [■ 停止] [→缩进] [←]` + 运行状态芯片；`[提交]` 与提交后的"已提交 HH:MM:SS"芯片在底部操作条
- 教师按什么按钮、在什么时点按：提交率够了按"下一段"（见 E）
- 教师是否需要看某个学生的实时画面 / 挑人上来讲：需要。镜像某学生时看到其最近的草稿或提交（代码 + 输出），草稿比提交新时标"草稿"

**B 学生做什么**
- 动作是什么：写代码 → 运行 → 看输出 → 提交
- 有几步，步与步之间是否有先后：两步；至少运行过一次才能提交
- 提交后能不能改：能，改完再运行、再提交，以最后一次为准
- 做不对时平台给什么反馈：Python 报错原样显示（裁掉内部帧）并附一行中文提示（全角标点、缩进、未定义的名字等），只说为什么没成功；死循环可按停止

**C 采集**
- 记什么字段：每人提交记录 `code`、`stdout`、`error`（"类型: 首行消息"）、`runs`、`ms`、`submittedAt`；另有草稿子记录 `draft`（同形状，无图，`at` 为时间，运行结束后与停止输入 5 秒后自动上报，不算提交）
- 记到人、记到组、还是只记到班：到人
- 课后要不要回看 / 进个人报告：可回看（只读）；进个人报告（见 D）

**D 统计**
- 教师统计视图看哪几列：姓名、运行次数、报错类型、提交时间（运行次数与报错取草稿与提交中较新的一份）；点行弹出"提交 / 草稿"两页，各为代码 + 输出
- 什么情况要提醒教师走过去：进入本段 5 分钟仍没运行过
- 要不要排行 / 推荐分享：不排行；无 `recommend` / `score`，分享与互助由教师手选
- 报告条目（`summarize`）："运行次数"、"提交结果"（"运行无报错"或异常类型）；只有草稿没提交时为"提交：未提交"

**E 推进条件**
- 教师按"下一段"时要满足：在线学生提交率 ≥ 70%（草稿不算）
- 不满足时：软提示（一键继续 / 可强制推）

**匹配原语**：代码沙盒（`primitive: null`，视图用 sandbox 组件的 `<PyRunner>`）

---

#### 实现要点

| 栏 | 文件 |
|---|---|
| A | `Student.jsx`：`<Page template="split" title={TASK}>`（`stage.config.js` 的 `layout: 'split'`）；`Page.Main` 放 `<PyRunner stageId="hello" draftEvent="student:draft" onResult onRestore>`（不传 `height`，由布局撑满），`Page.Actions` 放"已提交"芯片与 `[提交]`（不再用 `extraButtons`）；无 `TeacherDemo.jsx` |
| B | `server.js`：`student:submit`（`recordShape`）→ `data.set(name, { ...p, submittedAt })`；`student:draft`（`draftShape`）→ `data.set(name, { draft: { ...p, at } })` |
| C | `stage.config.js` 的 `collect`、`sandbox.starter` |
| D | `TeacherStats.jsx`（`AlertBar` + `DataTable` + `DetailModal` 内 `<PyOutput record>`）；`alerts` 的 `idle`（草稿里有运行痕迹：`runs > 0` 或带回了输出 / 报错）；`summarize` |
| E | `gate`，`soft: true` |

提交的是最近一次运行时的代码与结果（`buildRecord(result, { code, runs })`），不是编辑器里之后改动的代码。

`runs` 为本阶段运行次数：取 `PyRunner` 本实例的运行 + 测试次数（`onResult` / `onTest` 的第二参数 `{ runs }`，挂载时从 0 起；刷新页面后重新计数），草稿里的 `runs` 同样是这个数（02–04 同）。

刷新页面后，`PyRunner` 从本机恢复代码与最近一次结果，并经 `onRestore({ code, result })` 交给 `Student.jsx`，提交按钮按恢复的结果启用，不必再运行一次（02、03 同；04 不同，见该段）。

#### 限制说明

- 学生代码只在学生自己的浏览器里运行，服务端不执行；平板无需安装
- `turtle` / `tkinter` / `pygame` 等图形窗口库不可用（浏览器里没有窗口），报错时有中文提示
- starter 与题目不要引导学生输入真名（代码与输出会进记录、镜像与报告）
