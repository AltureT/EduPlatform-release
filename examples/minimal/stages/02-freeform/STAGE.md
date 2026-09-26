### 段 2 · 自由作答

> 核心教学事件：每个学生写下一段不超过 100 字的文字，可以反复修改。

**A 展示**
- 大屏投什么：本段不设演示视图，教师端只显统计视图
- 学生屏幕看什么：一个文本框（100 字上限）、已写字数 / 上限、保存按钮
- 教师按什么按钮、在什么时点按：写完即可按"下一段"，无门槛
- 教师是否需要看某个学生的实时画面 / 挑人上来讲：统计视图点行可看该生记录

**B 学生做什么**
- 动作是什么：写一段文字，按保存提交
- 有几步，步与步之间是否有先后：一步
- 提交后能不能改：能，每次保存覆盖上一次；刷新后文本框回填已保存内容
- 做不对时平台给什么反馈：超过 100（UTF-16 长度）输入框不再接收；服务端对超长 / 非字符串载荷校验拒绝

**C 采集**
- 记什么字段：每人 `text`、`length`（字数，与校验一致按 UTF-16 长度计，emoji 等非 BMP 字符计 2）；最后更新时间由内核的 `updatedAt` 提供
- 记到人、记到组、还是只记到班：到人
- 课后要不要回看 / 进个人报告：可回看（回看时不可交互）；进个人报告（见 D）

**D 统计**
- 教师统计视图看哪几列：姓名、字数、最后更新；点行弹出该生记录
- 什么情况要提醒教师走过去：无
- 要不要排行 / 推荐分享：不排行；无 `recommend`，share 侧栏列在线学生供教师手选
- 互助：无 `score`，邀请互助时教师须手选被帮助者
- 报告条目（report 组件，`summarize`）："字数"，附全班中位数（cohort.median，只计有记录的学生）；未作答的学生本段不出条目

**E 推进条件**
- 教师按"下一段"时要满足：无门槛
- 不满足时：—

**匹配原语**：开放作答（本示例 `primitive: null`，全部自写）

---

#### 实现要点

| 栏 | 文件 |
|---|---|
| A | `Student.jsx`；无 `TeacherDemo.jsx`（内核隐藏视图切换） |
| B | `server.js`：`student:write { text:'string:0-100' }` → `data.set(name, { text, length })` |
| C | `stage.config.js` `collect.perStudent` |
| D | `TeacherStats.jsx`（`AlertBar` + `DataTable` + `DetailModal`）；无 `alerts`；`stage.config.js` 的 `summarize` |
| E | `gate` 恒通过（显式写出，便于测试） |

#### 契约缺口

已由契约 v0.4.2 §十 解决。

- 原缺口：`ConfirmAdvanceBtn` 没有 props 签名，统计视图的推进按钮因此停下。现在按 §十 实现，只在 `isLive` 时渲染，放在 `TeacherStats.jsx`。
- v0.7（界面整理）：推进按钮改由外壳操作条提供，`TeacherStats.jsx` 不再渲染 `ConfirmAdvanceBtn`；`Student.jsx` 的根为 `<Page template="focus">`，输入框用 `<Fill>` 撑满，"保存"经 `Page.Actions` 进操作条；`stage.config.js` 写 `layout: 'focus'`。
