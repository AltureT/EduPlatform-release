# components/

可选组件：整节课都能用的功能（看学生屏、挑人分享、收作答、个人报告、Python 运行环境），在 `lesson.config.js` 的 `components` 里打开——写字符串 `'id'`，要带参数写 `{ id, ...参数 }`。没打开的组件不出现在任何页面上。

```js
// lesson.config.js
components: ['mirror', 'share', 'report'],
```

某一段不想显示某个组件的入口时，在那一段的 `stage.config.js` 写 `components: ['share']`（只列本段要显示的；只能写课程里已打开的），不写就是全部显示。

下面每个组件一段：**教师说法 → `lesson.config.js` 怎么写 → 上课时出现在哪里**。

## mirror · 镜像学生画面

- 教师说法："我想看某个学生正在做什么""把一个学生的屏投上来"。
- 写法：`components: ['mirror']`，没有参数。
- 上课时：教师顶栏有"👁 镜像 ▾"，下拉里点一个在线学生（或"随机"），教师主区换成该生当前这一段的学生页（只读，随他的操作实时变化）；点"✕"退出，进入下一段时自动退出。学生端看不到任何变化。

## share · 分享（邀请回答 / 邀请互助 / 推荐分享）

- 教师说法："挑做得好的上来讲""让做得好的帮做得差的""平台帮我挑人"。
- 写法：`components: ['share']`，没有参数。推荐谁由各段决定：原语段自动有（如投票推荐最早提交的 5 人）；自写段在 `stage.config.js` 写 `recommend` / `score`（契约 §二），不写就列全部在线学生供教师手选。
- 上课时：教师统计页右侧是推荐名单，每人一行"邀请回答""邀请互助"。
  - 邀请回答：大屏全屏显示这位学生这一段的页面（署名），学生端横幅区出现"正在分享：某某"，被邀请的学生看到"你正在分享给全班"。
  - 邀请互助：大屏左右两块——左边是匿名的"同学 A"（平台按 `score` 自动挑一个做得不好的，也可以手选），右边是帮忙的学生；只有帮忙的学生横幅区出现"帮一下 同学 A"，点开看 A 的页面。
  - 进入下一段时两者都自动收起。

## inbox · 收件箱

- 教师说法："课上随时让学生写一句话交上来，我在大屏上翻"（和某一段的教学活动无关的临时收集；某一段本身就是写作答，用 `free-text` 原语）。
- 写法：`components: [{ id: 'inbox', questions: [{ id: 'q1', title: '今天最有收获的一点', fields: [{ key: 'text', label: '写一句话', max: 100 }] }] }]`；只写 `'inbox'` 时教师现场输入题目，每人一个 200 字以内的框。
- 上课时：教师顶栏有"📥 收件箱"按钮，点开底部抽屉：选题或输入题目、"开启 / 关闭"、按时间倒序看收到的作答。开启后所有学生弹出作答框（学生关不掉，只有教师关闭后消失），交了可以改；换段不会自动关。

## report · 个人报告 + 导出

- 教师说法："课后每人一份报告，能扫码看""导出数据"。
- 写法：`components: ['report']`，没有参数。报告里每段写什么由各段决定：原语段自动有；自写段在 `stage.config.js` 写 `summarize`（契约 §二），不写就按 `collect.perStudent` 的字段逐项列出。
- 上课时：只在最后的谢幕页出现。教师谢幕页有"生成并推送报告"（点两次确认）、已生成人数、"导出 CSV"（全部记录的一张长表）；推送后每个学生的谢幕页出现自己的报告卡片（有全班中位数的条目会画对比条）。

## sandbox · Python 运行环境

- 教师说法："学生写一段 Python 跑一下""用 pandas 处理数据 / 画图""搭一个小网站"。用 `code` / `data-analysis` 原语的段必须打开它（`npm run new:stage` 生成这两种段时会自动加上）。
- 写法：`components: [{ id: 'sandbox', packages: ['pandas', 'matplotlib'] }]`。`packages` 是整节课提前下载的 Python 包（学生加入后空闲时就开始下载）；可选 `flask: true`（要搭网站）、`preload: 'stage'`（改成进入第一段 Python 段才下载）。每段自己的包和文件写在各段配置里（原语段看 `primitives/code/README.md`、`primitives/data-analysis/README.md`）。平台第一次用前要在管理台点"下载 Python 运行时"。
- 上课时：教师顶栏常驻"Python · 就绪 N / 在线 M"，点开看谁没就绪、谁报错；统计页右侧列出未就绪和最近出错的学生。学生端平时看不到它，只有下载失败时横幅区出现一行"Python：原因 [重试]"。

---

组件的实现细节（目录结构、服务端 `cctx`、客户端槽位、事件与载荷）见《可选组件规格》`docs/specs/2026-09-24-可选组件规格.md` 与《代码沙盒组件规格》`docs/specs/2026-09-24-代码沙盒组件规格.md`——做课时不需要读，也不改本目录。

```
components/<id>/
  component.config.js     # export default { id, label }        【必需】
  server.js               # export function register(cctx)      【可缺省】
  client.jsx              # export default { slots, store }     【可缺省】
  __tests__/*.test.js(x)  # 服务端 node --test，客户端 vitest
```
