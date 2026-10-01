# quiz · 小测验

一到三十道小题（单选 / 判断 / 填空精确匹配），学生一题一页顺序作答，最后提交一次，服务端自动判分。大屏看提交 N/M 与每题一行横条（内容随模式与是否揭晓而定，见下文"大屏"）；结果何时给学生看由 `showResultTo` 决定（提交即看 / 教师揭晓后看 / 不给看）。教师统计页、推进门槛、3 分钟未提交提醒、个人报告条目（我的得分与全班中位数、错题号）、分享推荐（得分高、提交早的 5 人）全部自动有。

作答自动保存，刷新不丢：未提交的作答与当前题号存在本机与服务端（刷新、断线、关浏览器、换设备都能回填），限时到点自动提交的是保存的作答；提交后清掉（学生输入自动保存规格）。

## options

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `items` | 1–30 题 | 必填 | 每题 `{ id?, type, question, choices?, answer, explain? }`，见下表 |
| `prompt` | 字符串 1–2000 字 | 无 | 全卷共用的正文 / 材料（阅读段落、情境、短信原文）：学生页每一题的题面之前、结果页最上方与大屏标题下方显示，纯文本，可多行（空行分段）；不是保密选项。**每题的一句话题面放 `items[].question`，共用材料放 `prompt`** |
| `shuffle` | 布尔 | `false` | 打乱题序：按学生名做稳定种子（同一学生刷新、换设备题序不变），服务端与客户端同一算法（`order.js`） |
| `showResultTo` | `'student-after-submit'` \| `'reveal'` \| `'never'` | `'student-after-submit'` | 提交后立刻看得分、逐题对错与解析 / 教师在演示页点"揭晓"后才看（多一个 `answer` → `reveal` 子阶段）/ 学生始终看不到 |
| `timeLimitSec` | 整数 10–7200 | 无 | 限时：学生页显示倒计时（从进入本段算），到时自动提交已答部分；服务端不拒绝超时提交 |
| `gate` | 声明式门槛 | `{ submitted: 0.7, soft: true }` | `false`、`{ submitted: 0.7 \| 'all', soft }`，或 `{ correct: 0.6, soft }` = **在线学生的平均得分率** ≥ 60%（**口径：平均比率**，未提交算 0，离线不计；与 vote 的 `correct` 按人数算不同）；阶段写 `gate(ctx)` 函数则以函数为准 |
| `idleAlertMs` | 毫秒 | `180000` | 进入本段多久未提交就提醒教师；`0` 不提醒 |

每道题：

| 键 | 说明 |
|---|---|
| `id` | 字母、数字、`-`、`_`，1–32 位，不重复；缺省按顺序 `q1`、`q2`… |
| `type` | `'single'` 单选 / `'truefalse'` 判断 / `'blank'` 填空 |
| `question` | 题面 1–500 字 |
| `choices` | 仅单选：2–8 项，字符串数组（键自动 A、B、C…）或 `[{ key: 'A'–'H', text }]`；判断、填空不写 |
| `answer` | 单选为一个选项键；判断为 `true` / `false`；填空为字符串或字符串数组（多个可接受答案），比对时去首尾空白、全角半角与大小写不敏感 |
| `explain` | 解析 1–1000 字，可缺省 |

**保密**：每题的 `answer` 与 `explain` 在加载时被移到顶层的 `answerKey` / `explanations`，二者是保密选项（`secretOptions`），学生收到的课堂状态里只有题面。它们到达学生的途径只有：

- `student-after-submit`：提交时本人记录写 `score`、`total`、`results`（逐题对错）与 `explanations`——**不写正确答案本身**，学生只看到自己哪题对哪题错与解析；
- `reveal`：提交时只记作答与用时；教师点"揭晓"时班级记录写 `{ answerKey, explanations, revealedAt }`，已提交者的记录补写 `score`、`total`、`results`，学生端（含回看、镜像）从这两处读；揭晓后不能再提交；
- `never`：都不写，学生只看到"已提交"与自己的作答。

采集：每人 `{ answers, submittedAt, elapsedMs, score?, total?, results?, explanations? }`（`answers` 为题目 id → 作答：单选为键、判断为布尔、填空为原文；`elapsedMs` 为进入本段到提交的用时）。只能提交一次，可以只答一部分。教师的统计页与门槛按 `answerKey` 现算得分，不必等揭晓。统计页的"用时"在设了 `timeLimitSec` 时，超过限时 5 秒以上标"超时"。`reveal` 模式揭晓后仍未提交的学生，学生页直接显示"已揭晓，未提交"。题号一律按 `items` 的原顺序（打乱题序时，结果页与报告里的"第 k 题"也是原题号）。

模拟片段 `__tests__/simulate.js`：`play` 让每个虚拟学生答完全部题（每题约六成答对）后提交。`loadAction` 第一次提交，之后服务端回"已提交"，以这条 `error:validation` 为回执（不再触发 `data.set`）——压测请用 vote / free-text 段；调用方没传 `ctx` 时提交空答卷。

## 示例

```js
// stages/04-prime-quiz/stage.config.js
export default {
  id: 'prime-quiz',
  label: '质数小测',
  primitive: 'quiz',
  options: {
    items: [
      { id: 'q1', type: 'single', question: '下列哪个数是质数？', choices: ['21', '27', '29', '33'], answer: 'C', explain: '29 只能被 1 和它本身整除' },
      { id: 'q2', type: 'truefalse', question: '1 是质数。', answer: false },
      { id: 'q3', type: 'blank', question: '最小的质数是？', answer: ['2', '二'] },
    ],
    showResultTo: 'reveal',
  },
};
```

目录里只要 `STAGE.md` 和这个文件。要追加提醒写 `alerts: [...]`（id 不能是 `idle`）；要换学生页就在阶段目录放自己的 `Student.jsx`（整体替换，服务端与采集不变）；`collect`、`subPhases`、`layout` 由原语决定，不能写。

## 大屏（教师演示页）

大屏全班都看得见，正确率和作答分布放在一起就能推出正确项，所以每题一行显示什么按模式定：

| 模式 | 每题横条 | 点题号展开作答分布 | 平均分 |
|---|---|---|---|
| `student-after-submit` | 正确率（答对 / 已提交） | 不提供 | 显示 |
| `reveal` 揭晓前 | "已答 n / 已提交 m"，没有百分比 | 不提供 | 不显示 |
| `reveal` 揭晓后 | 正确率 | 有，正确项高亮并显示正确答案 | 显示 |
| `never` | "已答 n / 已提交 m" | 有，但不显示对错与正确答案 | 不显示 |

## 什么会间接暴露对错

- **谢幕个人报告**（report 组件）：`student-after-submit` 与 `reveal` 模式下有"我的得分""错题号"，按 `answerKey` 现算，不管 `reveal` 模式有没有揭晓；`never` 模式只写"已提交，答了 n / N 题"。
- **分享组件的自动互助**（share）：`score` 为得分率，教师点"邀请互助"并选"自动"时从最低三分之一里挑被帮助者，被挑中的学生能猜到自己得分低。
- **分享推荐**：理由写"得分 x/N"。
- **大屏正确率**：`student-after-submit` 模式大屏一直显示每题正确率（不给分布），正确率很低或很高的题，还没交的学生能猜出多数人选的是不是对的；`reveal` 模式揭晓前、`never` 模式只显示已答人数。
- **先交的学生转告**：`student-after-submit` 下先交的学生立刻看到自己逐题对错与解析，可以转告还没交的同学；自由名单（`roster.mode: 'free'`）下还能另开一个假名随便交一份套出解析。要紧的测验用 `reveal`（揭晓后不能再交），或用固定名单。

`reveal` 模式建议在课内点"揭晓"，并且揭晓之后再用自动互助。

## 什么时候不该用 quiz

- 只有一道题、要全班分布上大屏 → 用 `vote`。
- 要写理由、开放作答 → 用 `free-text`。
- 要多选题、排序、连线、按步骤给分、或答对才能进下一题 → 自写阶段（`primitive: null`）。
