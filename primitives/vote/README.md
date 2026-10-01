# vote · 投票

一道单选或多选题，学生点选项提交，全班分布实时出现在大屏（柱状 + 提交 N/M）。写了 `answer` 就多一个"揭晓"环节：教师在演示页点"揭晓"，学生端显示对错与正确答案，大屏高亮正确项；不写 `answer` 就是纯民意投票。教师统计页、推进门槛、3 分钟未提交提醒、个人报告条目（我的选择 / 全班最多 / 是否答对）、分享推荐（提交最早的 5 人）全部自动有。

作答自动保存，刷新不丢：多选题未提交的勾选存在本机与服务端（刷新、断线、关浏览器、换设备都能回填）；提交后清掉（学生输入自动保存规格）。

## options

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `question` | 字符串 1–500 字 | 必填 | 题目，显示在标题区 |
| `prompt` | 字符串 1–2000 字 | 无 | 正文：学生页与大屏在标题下方、选项之前显示，纯文本，可多行（空行分段）；不是保密选项。**题目一句话放 `question`，短信原文 / 材料放 `prompt`**——长文放进 `question` 会整段挤在标题区 |
| `choices` | 2–8 项 | 必填 | 字符串数组（键自动 A、B、C…），或 `[{ key: 'A'–'H', text }]`；每项 1–200 字 |
| `multiple` | 布尔 | `false` | 多选：学生点多个再按"提交" |
| `answer` | 键或键数组 | 无 | 正确答案（单选只能一个）；写了才有"揭晓"子阶段（`answer` → `reveal`）。加载后统一成键数组。**保密选项**：学生收到的课堂状态里没有它，揭晓时才写进班级记录 |
| `anonymous` | 布尔 | `false` | 为 `true` 时大屏不能按选项展开名单 |
| `canChange` | 布尔 | `true` | 提交后能否改；揭晓后一律不能再交 |
| `gate` | 声明式门槛 | `{ submitted: 0.7, soft: true }` | `false`、`{ submitted: 0.7 \| 'all', soft }`，有 `answer` 时还可 `{ correct: 0.6, soft }`（**口径：人数比**，答对人数 / 在线人数，离线不计）；阶段写 `gate(ctx)` 函数则以函数为准 |
| `idleAlertMs` | 毫秒 | `180000` | 进入本段多久未提交就提醒教师；`0` 不提醒 |

采集：每人 `{ choice, submittedAt, correct? }`（单选 `choice` 为键，多选为键数组；`correct` 揭晓时才写，提交回执里没有，学生没法逐项试答案）；有 `answer` 时揭晓写班级记录 `{ answer, revealedAt }`（学生端的正确答案、回看与镜像都从这里读）。教师的统计页与门槛按 `answer` 现算对错，不必等揭晓。

模拟片段 `__tests__/simulate.js`：`play` 与 `loadAction` 从 `ctx.stageConfig` 取阶段 id 与 options；有 `answer` 时 `play` 在全部投完后由虚拟教师点"揭晓"（等到子阶段变成 `reveal`）再交给 simulate 推进；调用方没传 `ctx`（如 `e2e-restart.js`）时 `loadAction` 退化为"单选投 A、匹配任意阶段的回执"。

## 示例

```js
// stages/03-prime-vote/stage.config.js
export default {
  id: 'prime-vote',
  label: '质数投票',
  primitive: 'vote',
  options: {
    question: '下列哪个数是质数？',
    choices: ['21', '27', '29', '33'],
    answer: 'C',
    gate: { submitted: 0.7, soft: true },
  },
};
```

目录里只要 `STAGE.md` 和这个文件。要追加提醒写 `alerts: [...]`（id 不能是 `idle`）；要换学生页就在阶段目录放自己的 `Student.jsx`（整体替换，服务端与采集不变）；`collect`、`subPhases`、`layout` 由原语决定，不能写。

## 门槛进阶

`options.gate` 只能按"在线学生里满足条件的人数比例"算：

- 七成交了才能进、不能一键继续：`gate: { submitted: 0.7, soft: false }`。`soft: false` 时教师按"进入下一段"被拦下，要再点一次确认（强制继续）才进；`soft: true` 是一键"继续 →"。
- 全部交了：`{ submitted: 'all', soft: false }`；七成答对（要写 `answer`）：`{ correct: 0.7, soft: false }`。

"揭晓之后才能进下一段"不是比例，`options.gate` 表达不了：在阶段 `stage.config.js` **顶层**写 `gate(ctx)` 函数（契约 §五：阶段写了 `gate` 函数就只用阶段的，`options.gate` 不再生效）。下面这段可以整段复制再改文字：

```js
// stages/01-perceive/stage.config.js：揭晓之后、且七成在线学生交了，才能进下一段（都不能一键继续）
export default {
  id: 'perceive',
  label: '感知',
  primitive: 'vote',
  options: {
    question: '这条短信是诈骗还是正常？',
    prompt: '【快递中心】您的快递已丢失，3 倍理赔请点 kd-lp.cn/x8q 填银行卡号和验证码。',
    choices: ['诈骗', '正常'],
    answer: 'A',
  },
  gate(ctx) {
    if (ctx.state.subPhase !== 'reveal') return { ok: false, soft: false, reason: '还没揭晓答案' };
    const online = ctx.state.connected();
    const done = online.filter((s) => ctx.data.get(s.name)?.choice != null).length;
    if (done < Math.ceil(online.length * 0.7)) {
      return { ok: false, soft: false, reason: `已提交 ${done}/${online.length}，未到 70%` };
    }
    return { ok: true };
  },
};
```

- 子阶段读 `ctx.state.subPhase`（没有 `ctx.subPhase`）；写了 `answer` 才有 `answer` → `reveal` 两个子阶段，没写 `answer` 时永远不会是 `'reveal'`，这段门槛会一直拦着。
- 每人的记录是 `ctx.data.get(姓名)`，提交过的有 `choice`；分母用 `ctx.state.connected()`（离线不计）。
- `reason` 是教师端被拦下时看到的一句话。
- "七成交了才能揭晓"做不到：演示页的"揭晓"按钮不看门槛，教师看大屏的"提交 N/M"再按；一定要拦，只能在阶段目录自写 `TeacherDemo.jsx` 覆盖原语的演示页。

## 什么会间接暴露对错

学生收到的课堂状态里没有 `answer`，提交回执里也没有 `correct`；但下面两处按实际对错工作，揭晓前用到就会让学生间接看出对错：

- **谢幕个人报告**（report 组件）：条目"是否答对"按 `answer` 现算，不管这一段有没有揭晓。
- **分享组件的自动互助**（share）：`score` 答对 1、答错 0.5，教师点"邀请互助"并选"自动"时从最低三分之一里挑被帮助者——揭晓前就这么做，被挑中的学生能猜到自己答错了。

建议写了 `answer` 的投票都在课内点"揭晓"，并且揭晓之后再用自动互助。

## 什么时候不该用 vote

- 一段里有好几道题、要算分 → 用 `quiz`。
- 学生要写字说理由 → 用 `free-text`（或 vote 之后接一段 free-text）。
- 要按学生的选择分组、或下一段要读这一段的选择做分支 → 自写阶段（`primitive: null`）。
- 选项要配图、要排序、要连线 → 不是 vote，自写或等对应原语。
