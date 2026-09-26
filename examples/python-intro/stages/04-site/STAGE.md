### 段 4 · 小网站

> 核心教学事件：学生改一个最小的 Flask 留言板，在模拟浏览器里点链接、提交表单、看到重定向后的页面。

**A 展示**
- 大屏投什么：本段不设演示视图，教师端只显统计视图（首页状态码、运行次数、报错、提交时间）；需要时镜像某学生
- 学生屏幕看什么：题目"改一改这个留言板网站，在下方模拟浏览器里访问、提交表单看效果"；上半屏为编辑器（starter 为最小 Flask 应用：首页 + 表单 POST 到 `/add` 后 `redirect('/')`）与输出区 + 运行按钮行；下半屏为模拟浏览器 `[◀] [▶] [↻] [地址] [前往]` + 状态码芯片；`[提交]` 与提交后的"已提交 HH:MM:SS · 首页 200"芯片在底部操作条
- 教师按什么按钮、在什么时点按：提交率够了按"下一段"（见 E）
- 教师是否需要看某个学生的实时画面 / 挑人上来讲：可镜像（镜像里模拟浏览器只显示禁用的地址栏，代码与输出照常）

**B 学生做什么**
- 动作是什么：改代码 → 运行 → 在模拟浏览器里访问、提交表单 → 提交
- 有几步，步与步之间是否有先后：至少运行过一次才能提交；每次成功运行后模拟浏览器自动刷新当前页
- 提交后能不能改：能，以最后一次为准
- 做不对时平台给什么反馈：Python 报错 + 中文提示；还没有 `app` 时模拟浏览器显示"502 · 还没有定义 app，请先运行"；状态码 ≥ 400 芯片标红，仍显示响应内容；外链不打开

**C 采集**
- 记什么字段：每人 `code`、`stdout`、`error`、`runs`、`ms`、`homeStatus`（最后一次成功运行之后，模拟浏览器最近一次以 GET 打开、最终落在 `/` 的页面的状态码（POST 表单重定向回首页不算）——成功运行后模拟浏览器自动刷新当前页，停在首页时即得到；运行后停在别的页面、还没回首页时为 null；最后一次运行报错或被停止时记为 null——此时模拟浏览器用的还是更早一次成功运行的 app，状态码会过时；还没有 app 时为 502，超时等拿不到时为 null）、`submittedAt`
- 记到人、记到组、还是只记到班：到人
- 课后要不要回看 / 进个人报告：可回看（只读）；进个人报告

**D 统计**
- 教师统计视图看哪几列：姓名、首页状态码（已提交但为 null 时显示"未检查"）、运行次数、报错类型、提交时间；点行弹出代码 + 输出
- 什么情况要提醒教师走过去：进入本段 8 分钟未提交；提交时首页打不开（状态码不是 2xx / 3xx；null 即未检查，不提醒）
- 要不要排行 / 推荐分享：不排行；无 `recommend` / `score`
- 报告条目（`summarize`）："首页状态码"（拿不到为"无"）

**E 推进条件**
- 教师按"下一段"时要满足：在线学生提交率 ≥ 70%
- 不满足时：软提示（一键继续 / 可强制推）

**匹配原语**：代码沙盒 + 模拟 Web 服务器（`primitive: null`）

---

#### 实现要点

| 栏 | 文件 |
|---|---|
| A | `Student.jsx`：`<Page template="split" title={TASK}>`（`layout: 'split'`）；`Page.Main` 里两个 `<Fill>` 上下各半，分别放 `<PyRunner stageId="site" onResult>` 与 `<WebSim stageId="site" home="/" onResponse>`（都不传 `height`），`Page.Actions` 放"已提交"芯片与 `[提交]`；无 `TeacherDemo.jsx` |
| B | `server.js`：`student:submit`，schema 为 `recordShapeWith({ homeStatus: 'optional:integer:100-599' })` → `data.set(name, { ...p, homeStatus: p.homeStatus ?? null, submittedAt })` |
| C | `stage.config.js`：`sandbox.flask: true`、`sandbox.starter`、`collect` |
| D | `TeacherStats.jsx`（`DataTable` + `DetailModal` 内 `<PyOutput record>`）；`alerts` 的 `idle` / `home-error`；`summarize` |
| E | `gate`，`soft: true` |

`homeStatus` 由 `Student.jsx` 从 `<WebSim onResponse>` 记录：每次运行结束先置 null；最后一次运行 `ok` 时，接受之后 `method` 为 GET 且 `finalPath` 为 `/` 的导航结果（含运行后的自动刷新）；提交时不再自己发请求。

刷新页面后提交按钮保持禁用，直到再运行一次：本段提交要求 app 在跑，而刷新后运行环境是新的、还没有 app（模拟浏览器显示"502 · 还没有定义 app，请先运行"），所以本段不接 `onRestore`；编辑器里的代码与最近一次输出照常恢复。`runs` 为 `PyRunner` 本实例运行次数（`onResult` 的第二参数）。

#### 限制说明

- 不要写 `app.run()`：模拟浏览器直接把请求交给学生代码里名为 `app` 的 Flask 应用，不启动真实服务器
- 模拟浏览器不能访问外网；页面里的相对链接、表单、`fetch` 都回到学生自己的 `app`
- 每次运行是新的命名空间，留言等内存数据在重新运行后清空
- `turtle` / `tkinter` / `pygame` 不可用；starter 与题目不要引导学生输入真名（留言内容会进记录）
