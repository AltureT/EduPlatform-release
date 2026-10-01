### 段 3 · 过测试

> 核心教学事件：学生按函数签名实现 `grade(score)`，用测试检查自己的代码，全部通过才能提交。

**A 展示**
- 大屏投什么：本段不设演示视图，教师端只显统计视图（通过数、运行次数、提交时间）
- 学生屏幕看什么：题目（`grade(score)`：≥ 90 "优秀"、≥ 60 "及格"、否则"不及格"）；编辑器（starter 给函数签名与 `if __name__ == '__main__':` 示例调用）与输出区（测试摘要"通过 6 / 7"与失败用例名、消息）撑满一屏 + `[▶ 运行] [■ 停止] [🧪 测试]`；`[提交]` 与"已提交"芯片在底部操作条，`[提交]` 在当前代码测试全部通过后才可点
- 教师按什么按钮、在什么时点按：提交率够了按"下一段"（见 E）
- 教师是否需要看某个学生的实时画面 / 挑人上来讲：推荐分享列出最先全部通过的前 5 人

**B 学生做什么**
- 动作是什么：写函数 → 运行 / 测试 → 全部通过 → 提交
- 有几步，步与步之间是否有先后：测试全部通过才能提交；测试后改了代码需重新测试
- 提交后能不能改：能，以最后一次为准
- 做不对时平台给什么反馈：测试摘要 + 失败用例名与断言消息；服务端拒收未全部通过的提交（"测试未全部通过"）

**C 采集**
- 记什么字段：每人 `code`、`stdout`、`error`、`tests`（`passed / failed / errors / total`）、`runs`、`ms`、`submittedAt`
- 记到人、记到组、还是只记到班：到人
- 课后要不要回看 / 进个人报告：可回看（只读）；进个人报告

**D 统计**
- 教师统计视图看哪几列：姓名、通过（`passed / total`）、运行次数、提交时间；点行弹出代码 + 测试结果
- 什么情况要提醒教师走过去：进入本段 8 分钟仍未全部通过
- 要不要排行 / 推荐分享：不排行；`recommend` 列全部通过者按提交先后前 5，理由"第 N 个全部通过"；`score` = 通过用例数
- 报告条目（`summarize`）："通过用例"（如 `7 / 7`），附全班中位数

**E 推进条件**
- 教师按"下一段"时要满足：在线学生提交率 ≥ 70%（只有全部通过才能提交）
- 不满足时：软提示（一键继续 / 可强制推）

**匹配原语**：代码沙盒（`primitive: null`）

---

#### 实现要点

| 栏 | 文件 |
|---|---|
| A | `Student.jsx`：`<Page template="split" title={TASK}>`（`layout: 'split'`）；`Page.Main` 放 `<PyRunner stageId="tests" onResult onTest onRestore>`（不传 `height`），`Page.Actions` 放"已提交"芯片与 `[提交]`（`lastTest.total > 0 && lastTest.passed === lastTest.total` 且测试时代码与当前一致才启用；刷新后最近一次是测试时按恢复的测试结果启用）；无 `TeacherDemo.jsx` |
| B | `server.js`：`student:submit`（`recordShape`）→ 复核 `tests` 全部通过，否则 `reject`；通过则 `data.set(name, { ...p, submittedAt })` |
| C | `stage.config.js`：`sandbox.tests['test_grade.py']`（3 个用例，`from main import grade`）、`sandbox.starter`、`collect` |
| D | `TeacherStats.jsx`（`DataTable` + `DetailModal` 内 `<PyOutput record>`）；`alerts` 的 `idle`；`recommend` / `score` / `summarize` |
| E | `gate`，`soft: true` |

提交记录的 `code` 是测试时的代码；`stdout` / `ms` 取同一份代码最近一次运行的结果，没有运行过则取测试输出。

#### 限制说明

- **测试内容学生可见**：`sandbox.tests` 会打进前端，学生能在开发者工具里看到测试源码；不要把它当作保密的判分依据
- 学生代码按 `main.py` 被测试导入，所以示例调用要放进 `if __name__ == '__main__':`
- `turtle` / `tkinter` / `pygame` 不可用；题目不要引导学生输入真名
