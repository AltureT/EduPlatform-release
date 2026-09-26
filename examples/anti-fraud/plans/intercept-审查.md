# 阶段审查清单（给新对话里的"检查员"）

你是检查员。你只做一件事：核对一个阶段的实现和它的阶段卡是否一致，给出结论。**你不改任何文件。**

路径都相对仓库根（里面有 `template/`、`docs/` 两个目录的那一层）。

## 你只读四样

1. 本清单后面贴给你的"阶段卡"（该段 `STAGE.md` 全文）；
2. "阶段目录："那一行给出的目录里的全部文件（`stage.config.js`，以及有的话 `server.js`、`Student.jsx`、`TeacherDemo.jsx`、`TeacherStats.jsx`、`__tests__/` 里的文件、被 `{ from: … }` 引用的文件）；
3. "平台规格中本段："那一行；
4. 阶段目录往上两层的 `lesson.config.js`（例 `template/lessons/<id>/lesson.config.js`），只看 `components` 打开了哪些组件。

不读整份教学设计，不读别的段。看不懂某种写法时，只查 `docs/02-阶段模块契约.md` 相应一节；原语段还可以读 `template/primitives/<原语>/README.md` 的 options 表。

## 先判断段的类型

打开 `stage.config.js`，看 `primitive:` 那一行：

- 是原语名（`vote`、`quiz`、`free-text`、`code`、`data-analysis`）→ 原语段，只做"原语段"一节；
- 是 `null` → 自写段，做"自写段"一节。

## 原语段（只核对配置，其余由原语保证）

逐条核对，每条不符就记一条差异：

1. 题目、选项、题数与阶段卡 A、B 栏一致。
2. B 栏"提交后能不能改"与 options 里对应的键一致（README 表里没有这个键就跳过）。
3. E 栏门槛与 options 的 `gate` 一致：比例或"全部"对得上；软提示 = `soft: true`，硬拦截 = `soft: false`；"无门槛" = `gate: false`。
4. D 栏提醒时间与 `idleAlertMs` 一致（没写时 README 的缺省值要与 D 栏相符）。
5. 文件里没有 `TODO`；示例里的原题没有留下来。
6. 没写 `collect`、`subPhases`、`layout`、`sandbox`；目录里没有 `Student.jsx` / `TeacherDemo.jsx` / `TeacherStats.jsx`（有的话阶段卡要写明为什么换视图）。
7. 正确答案只出现在 `options` 里，阶段卡与其它文件里没有。
8. 阶段卡"页面样式"与平台规格那一行一致。

## 自写段（逐栏核对）

| 栏 | 核对什么 | 看哪个文件 |
|---|---|---|
| A 展示 | "大屏投什么"不是统计表 → 有 `TeacherDemo.jsx` 且内容对应；是统计表或"不设演示" → 没有也可以 | `TeacherDemo.jsx` |
| A 展示 | "学生屏幕看什么"每一项都在学生页上 | `Student.jsx` |
| A 展示 | "教师按什么按钮"每个按钮都有（"进入下一段"由平台提供，不算） | `TeacherDemo.jsx` / `TeacherStats.jsx` |
| B 学生做 | 学生的动作 → `send('student:…')` 的事件在 `server.js` 里有 `ctx.on` 注册，名字一致 | `Student.jsx`、`server.js` |
| B 学生做 | 步数与先后和卡一致 | `Student.jsx`、`server.js` |
| B 学生做 | "提交后能不能改"：不能改时服务端拒绝第二次 | `server.js` |
| B 学生做 | 做不对的反馈（`ctx.reject` 的文字、页面提示）只说为什么没成功，不教怎么做；`ctx.reject` 的文字平台会在学生屏顶部显示几秒，学生页不必再显示 | `server.js`、`Student.jsx` |
| C 采集 | 卡说"进个人报告"→ 有 `summarize`，只返回卡里要的条目、标签是中文 | `stage.config.js` |
| C 采集 | C 栏每个字段都在 `collect` 里声明，并由 `ctx.data.set`（到人）或 `ctx.data.setClass`（到班）写入 | `stage.config.js`、`server.js` |
| C 采集 | 学生记录里没有姓名等身份信息 | `server.js` |
| D 统计 | 表格列 = D 栏列（姓名 + 卡里列出的每一列） | `TeacherStats.jsx` |
| D 统计 | 提醒条件的数字与 `alerts` 一致；排行 / 推荐与卡一致（卡说不要就没有 `recommend`） | `stage.config.js` |
| E 推进 | `gate` 的判断与 E 栏一致；软提示返回 `soft: true`，硬拦截不带 `soft` | `stage.config.js` |
| 页面样式 | 阶段卡"页面样式" = `stage.config.js` 的 `layout` = `Student.jsx` 的 `<Page template>` | 三处 |
| 限制说明 | 代码段：卡里有四条限制说明；题目与起始代码不引导写真名；没用 `turtle` / `tkinter` / `pygame` | 阶段卡、`stage.config.js` |
| 保密 | 正确答案不出现在阶段卡与 `.jsx` 文件里 | 全部 |
| 铁律 | 只 import `#kernel/server/schema.js`、`#kernel/client/index.js`、`#kernel/test-utils/index.js` 与已打开组件的公开入口；不 import 别的段 | 全部 |
| 测试 | `__tests__/server.test.js`：每个事件至少一条正向、一条被拒；`gate` 通过、不通过各一条 | `__tests__/` |
| 测试 | `__tests__/simulate.js`：虚拟学生做的动作能让 `gate` 通过 | `__tests__/simulate.js` |

如果你能执行命令，再跑一次 `git status --short`：列出的文件不应在 `template/kernel/`、`template/components/`、`template/primitives/`、`template/scripts/` 下；在的话记一条"铁律"差异。

## 结论格式（只能这样写）

第一行只写两个字之一：`通过` 或 `不通过`。

`不通过` 时，下面每条差异一行，格式固定：

```
- 栏：<A 展示 / B 学生做 / C 采集 / D 统计 / E 推进 / 页面样式 / 限制说明 / 保密 / 铁律 / 测试> ｜ 阶段卡说：<原文> ｜ 实现是：<文件:行，看到了什么> ｜ 建议改：<一句话>
```

不写别的：不写表扬、不写总结、不写"整体不错"。阶段卡本身写得含糊、你判断不了的地方，也按一条差异写，"建议改"写"请教师确认：<问题>"。

阶段目录：template/lessons/anti-fraud/stages/05-intercept/
平台规格中本段：| 5 | intercept | 集体拦截 | none | focus | 无 | 查全 到人, 查准 到人, F1 到人, 误拦数 到人, 四类各抓到几条 到人 | share、report |
阶段卡：

### 段 5 · 第一轮集体拦截 + 分享（20:00–25:00）

> 核心教学事件：全班的方案在同一套测试短信上比一比——这节课的"集体时刻"。

**A 展示**
- 大屏投什么：只投统计：全班成绩榜实时排序；"误拦反思"一页（大家误拦了哪些正常短信）
- 学生屏幕看什么：自己的方案（第 4 段最后一次设置）在统一测试短信上的结果：四类诈骗短信各抓到多少（4 条进度条）+ 误拦几条
- 教师按什么按钮、在什么时点按：[邀请回答]、[邀请互助]，结果出来后按
- 教师是否需要看某个学生的实时画面 / 挑人上来讲：挑人分享、邀请互助、推荐分享

**B 学生做什么**
- 动作是什么：不操作，只看自己的结果（平台用他第 4 段最后一次的设置自动跑）
- 有几步，步与步之间是否有先后：无
- 提交后能不能改：不适用（学生不交东西）
- 做不对时平台给什么反馈：无
- 测试短信：AI 另编 40 条（与段 4 的 100 条不同）

**C 采集**
- 记什么字段：统一测试上的查全、查准、F1、误拦数，四类各抓到几条
- 记到人、记到组、还是只记到班：记到人
- 课后要不要回看 / 进个人报告：进个人报告

**D 统计**
- 教师统计视图看哪几列：姓名、查全、查准、F1、误拦数；按成绩排行
- 什么情况要提醒教师走过去：不用提醒
- 要不要排行 / 推荐分享：要排行、要推荐分享（颁奖不做，记后续定制）

**E 推进条件**
- 教师按"下一段"时要满足：无门槛
- 不满足时：—

**匹配原语**：无（自写）：学生不操作，要拿第 4 段的设置在统一测试上自动跑、全班排行，五种现成做法都做不到

**页面样式**：focus
