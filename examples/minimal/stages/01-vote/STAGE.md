### 段 1 · 投票

> 核心教学事件：每个学生对一道单选题做出自己的选择，全班分布实时出现在大屏上。

**A 展示**
- 大屏投什么：题目 + 四个选项的人数柱状分布（`BarDistribution`，随提交实时变化）+ 提交 N/M（N 为在线已提交，M 为在线人数）
- 学生屏幕看什么：题目 + 四个选项按钮，当前所选高亮
- 教师按什么按钮、在什么时点按：提交率够了按"下一段"（见 E）
- 教师是否需要看某个学生的实时画面 / 挑人上来讲：不需要；统计视图点行可看该生记录

**B 学生做什么**
- 动作是什么：点一个选项提交
- 有几步，步与步之间是否有先后：一步
- 提交后能不能改：能，随时改选，以最后一次为准
- 做不对时平台给什么反馈：选项之外的值被拒绝（schema 校验）；本阶段非当前阶段时按钮不可点

**C 采集**
- 记什么字段：每人 `choice`（A/B/C/D）、`submittedAt`（最近一次提交时间）；班级 `question`、`options`（进入本阶段时写入）
- 记到人、记到组、还是只记到班：到人（choice、submittedAt）+ 到班（question、options）
- 课后要不要回看 / 进个人报告：可回看（回看时不可交互）；进个人报告（见 D）

**D 统计**
- 教师统计视图看哪几列：姓名、是否提交、选项、提交时间；点行弹出该生记录
- 什么情况要提醒教师走过去：进入本阶段 3 分钟仍未提交
- 要不要排行 / 推荐分享：不排行；推荐分享（share 组件）列已提交者按提交时间先后前 5 人，理由"第 N 个提交"（`recommend`）
- 互助：`score` 提交为 1、未提交为 0；教师点"邀请互助"且被帮助者选"自动"时，share 从最低三分之一（即未提交者）里随机挑一位
- 报告条目（report 组件，`summarize`）："我的选择"（如 `C（29）`）、"全班最多的选项"（并列时全部列出）；未作答的学生本段不出条目

**E 推进条件**
- 教师按"下一段"时要满足：在线学生提交率 ≥ 70%（离线学生不计入分母）
- 不满足时：软提示（一键继续 / 可强制推）

**匹配原语**：判断投票（本示例 `primitive: null`，全部自写，作为契约的可执行示例）

---

#### 实现要点

| 栏 | 文件 |
|---|---|
| A | `TeacherDemo.jsx`（题目 + 分布 + N/M）、`Student.jsx`（题目 + 四按钮） |
| B | `server.js`：`student:vote { choice:'enum:A,B,C,D' }` → `data.set(name, { choice, submittedAt })` |
| C | `stage.config.js` `collect`；`onEnter` 里 `setClass({ question, options })`，题目与选项为文件顶部常量 `QUESTION` / `OPTIONS` |
| D | `TeacherStats.jsx`（`AlertBar` + `DataTable` + `DetailModal`）；`alerts` 的 `idle`；`stage.config.js` 的 `recommend` / `score` / `summarize` |
| E | `stage.config.js` `gate`，`soft:true` |

视图读 `classData` / `perClass` 里的题目与选项；`onEnter` 是 fire-and-forget，班级记录到达前用本目录 `stage.config.js` 的同名常量兜底。

#### 契约缺口

已由契约 v0.4.2 §十 解决。

- 原缺口一：`ConfirmAdvanceBtn`（以及 `Btn`、`Card`、`Chip`）没有 props 签名，教师视图的推进按钮因此停下。现在按 §十 实现：`<ConfirmAdvanceBtn onAdvance={() => advance()}>进入下一段 →</ConfirmAdvanceBtn>`，只在 `isLive` 时渲染，`TeacherDemo.jsx` 与 `TeacherStats.jsx` 里各放一个。
- 原缺口二：没有列出主题 token 名。§十 已列出，本阶段用到的 `--brand --brand-soft --border --surface --ink --radius --fs-lg` 都在清单内。
- v0.7（界面整理）：推进按钮改由外壳操作条提供，`TeacherDemo.jsx` 与 `TeacherStats.jsx` 不再渲染 `ConfirmAdvanceBtn`；`Student.jsx` / `TeacherDemo.jsx` 的根为 `<Page template="focus">`（题目进标题区），`stage.config.js` 写 `layout: 'focus'`。
