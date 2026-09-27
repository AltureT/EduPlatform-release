# 作品墙（课程组件 gallery）

这是"原语巡礼"这节课自己的功能，只在这节课里有效，也是做课程组件的范本。

## 老师怎么用

- 在"成绩分析"这一段，顶部多一个"作品墙 (N)"按钮，N 是已经画出图的人数。
- 点一下，全班最近画的图铺成一面墙，每张写着名字。点其中一张，这张放大，全班学生的屏幕上也同时看到它；点"返回"回到整面墙，点"关闭"收起。
- 学生这边没有打开作品墙的按钮，只在题目下方看到一行"作品会上作品墙，画好后点运行"。
- 换到下一段、或重置课堂，作品墙自动收起。
- 课后个人报告里多一节"作品墙"：我的图被展示过几次。

## 给 AI：开在哪些段

- `lesson.config.js`：`components` 里写 `'gallery'`；可写 `{ id: 'gallery', source: '<阶段 id>', anonymous: true }`——`source` 是取图的段（缺省 `score-analysis`），`anonymous` 为真时学生端放大的图不显示名字（教师端照常显示）。
- 阶段 `stage.config.js` **顶层**写 `gallery: true` 的段才有按钮和那一行提示（本课是 `stages/05-data`）。

## 给 AI：事件与数据形状

| 事件 | 谁发 | 载荷 | 行为 |
|---|---|---|---|
| `gallery:t-open` | 教师 | `{}` | 当前段 `gallery` 为真才行；读来源段全部记录，每人取最近记录的第一张图（最近运行优先，没有再看最终稿），定向发给教师 `gallery:wall`；清掉 `spotlight` |
| `gallery:t-spotlight` | 教师 | `{ name? }` | 从来源段重新取该生的图（没有或超过 100 KB 拒绝）：写 `perClass.spotlight = { name, image, at }`，该生 `perStudent.shown + 1`（重复点同一人不加）；不带 `name` 取消放大 |
| `gallery:t-close` | 教师 | `{}` | `perClass.spotlight = null`，定向发给教师 `gallery:closed` |

- 服务端发给教师（`cctx.emitTeachers`，不进班级记录）：`gallery:wall { wall: [{ name, image, at }], skipped, openedAt }`、`gallery:closed {}`
  - `wall` 按出图先后排，最多 60 人；每张图（PNG 的 base64）超过 100 KB 的跳过；两种跳过都计入 `skipped`
  - 教师端存在本地切片（`store.teacher`）里；刷新页面后墙收起，再点一次按钮重取
- `perClass = { spotlight: { name, image, at } | null }`：全班都收得到、刷新后仍在，所以每次只放放大的那一张图
- `perStudent[name] = { shown: number }`
- `report(name)` → `[{ label: '我的图被展示过', value: 'N 次' }]`
- 钩子：`onStageChange`、`onReset` 同 `t-close`（清 `spotlight`、教师端收起）

## 文件

- `server.js`：事件、`buildWall` / `pickImage`（纯函数，测试直接调）、`report`
- `client.jsx`：`teacherToolbar`、`teacherOverlay`、`studentOverlay`、`studentAside`
- `stageConfig.js`：`useGalleryStage(stageId)` 读本段 `gallery` 字段（单测里 mock 它）
- `__tests__/server.test.js`、`__tests__/client.test.jsx`
