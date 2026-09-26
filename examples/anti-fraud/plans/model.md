# 计划 · 段 2 体验 + 建模（model）

## 事件
- 学生发：student:pick { features: 特征键数组 } —— 第一步点"确定"时发；服务端按每个特征固定 20 分算 5 条示例短信得分，写记录（契约 §三）
- 学生发：student:verify { weights: { 特征键: 0–100 整数 } } —— 第二步点"验证我的设置"时发；未放权 → ctx.reject('老师还没放权')；算 5 条得分，3 条诈骗都 ≥ 60、2 条正常都 < 60 为通过；可反复发，以最后一次为准
- 教师发：teacher:release {} —— 放权；setClass({ released: true, releasedAt })，并给每个学生记录写 releasedAt（提醒用，记录不含姓名）；重复放权不改时间
- 题目数据放本段目录 data.js：6 个特征（链接、催促限时、转账汇款、冒充身份、高额回报、索要卡号验证码）与 5 条示例短信（3 诈骗、2 正常，命中特征固定）、线 60、第一步固定 20 分、算分函数；视图与 server.js 都从这里取

## 记录字段
- perStudent：step1Features（array）、step1Scores（array）、step1At（integer）、weights（object）、verifyScores（array）、passed（boolean）、verifyCount（integer）、verifiedAt（integer）、releasedAt（integer）；perClass：released（boolean）、releasedAt（integer）；不存学生姓名
- 个人报告条目：C 栏说不进报告 → summarize 返回 []（契约 §二）

## 视图
- Student.jsx：<Page template="stack">；Main 放第一步表格（勾特征 → 5 条短信得分）与第二步表格（每特征权重滑杆 → 5 条得分、验证结果只说哪条落在线的哪一边）；未放权时第二步显示"等老师放权"且不可操作；Actions 放当前步的主按钮（"确定" / "验证我的设置"）（契约 §四）
- TeacherStats.jsx：表格列 = D 栏：姓名、第一步完成、第二步验证（通过 / 未通过 / 未验证）；表格上方一行 Chip"验证通过 x/n"；提醒 alerts：放权后 3 分钟未验证通过（s.releasedAt 存在、s.passed 不为 true、now - s.releasedAt > 180000）
- TeacherDemo.jsx：要（A 栏大屏是两步表格演示 + [放权]）：<Page template="focus">，Main 放 5 条短信 × 特征表与"验证通过 x/n"，Actions 放 [放权]（放权后显示"已放权"、不可点）

## 门槛
- E 栏"全部在线学生第二步验证通过；软提示" → gate：在线学生都 passed === true → ok；否则 { ok: false, soft: true, reason: '验证通过 x/n' }（契约 §二）

## 测试要点
- server.test.js：step1 正向 / 非法特征键被拒；verify 未放权被拒、放权后通过、不通过、权重越界被拒；release 教师正向、学生发被拒；gate 通过、不通过各一条（契约 §七）
- simulate.js：教师先发 teacher:release，再让每个虚拟学生发 step1 与一组能通过的权重，收到本人 stage:my-data 且 passed 为 true 即完成
