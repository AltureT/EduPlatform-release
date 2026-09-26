# 计划 · 段 4 开放调参（tune）

## 事件
- 学生发：student:test { weights: { 特征键: 0–100 整数 }, threshold: 0–300 整数, predict?: { caught: 0–60 整数, blocked: 0–40 整数, recallTrend: 'up'|'down'|'same', precisionTrend: 'up'|'down'|'same' } } —— 点"检验"时发；第一次检验 predict 可缺省，之后缺 predict → ctx.reject('先填 4 项预测')；服务端在 100 条样本上算抓到几条（caught）、误拦几条（blocked）、查全、查准、F1，与预测比对得猜中几项，写记录（契约 §三）
- 没成功（查全 < 70% 或 误拦 > 5）时记录写 failReason（"抓到的诈骗不到七成" / "误拦正常短信超过 5 条"），只说为什么，不说调哪个；连续没成功计数 failStreak，成功清零
- 猜中规则：抓到几条 |预测 − 实际| ≤ 3；误拦几条 |预测 − 实际| ≤ 2；升降按与上次比差值 > 0.02 为升、< −0.02 为降、否则差不多
- 教师发：无（镜像、邀请回答、邀请互助、推荐由平台默认的组件提供）
- 样本放本段目录 data.js：6 个特征（与段 2 同一套）、100 条样本（60 诈骗四类都有、40 正常），每条标命中特征；算分与指标函数；视图与 server.js 都从这里取

## 记录字段
- perStudent：tests（integer）、last（object：weights、threshold、caught、blocked、recall、precision、f1、success、at）、history（array，每次 { weights, threshold, caught, blocked, recall, precision, f1, success, predict, hits, at }，最多 200 条，只防记录无限变大）；last 另记 hitItems（每项是否猜中与实际升降）、bestF1（number）、predicted（integer，填了预测的次数）、hitsTotal（integer）、failStreak（integer）、failReason（text）、testedAt（integer）；perClass：无；不存学生姓名
- 个人报告条目：检验次数 = tests；最好 F1 = bestF1（附全班中位数）；累计猜中 = hitsTotal（summarize，契约 §二）

## 视图
- 共用面板 Panel.jsx（本段目录）：权重滑杆 × 6 + 线滑杆 | 100 条得分分布（SVG，诈骗 / 正常两色，线的位置）+ 检验成绩折线（SVG）+ 各特征贡献条（Bar）
- Student.jsx：<Page template="split">；Main 放滑杆与预测卡（4 项预测 → 检验）；Side 放分布、折线、贡献条与最近一次结果（含 failReason）；Actions 放"检验"（契约 §四）
- TeacherStats.jsx：表格列 = D 栏：姓名、检验次数、查全、查准、F1、预测填写率（分母不算不用填的第一次）、累计猜中；提醒 alerts：5 分钟未检验（tests 为空且进入本段 > 300000 ms）；连续 2 次没成功（failStreak ≥ 2）
- TeacherDemo.jsx：要（A 栏大屏默认是教师自己的调参面板）：<Page template="focus">，Main 放 Panel（本地演示，不发事件）

## 门槛
- E 栏"全部在线学生至少检验过一次；硬拦截" → gate：在线学生都 tests ≥ 1 → ok；否则 { ok: false, reason: '已检验 x/n' }，不带 soft（契约 §二）
- recommend：两类各推荐：成绩最好（bestF1 前 3，理由"最好 F1 x"）与实验最认真（predicted 最多前 2，理由"填了 n 次预测"）；score = bestF1

## 测试要点
- server.test.js：test 首次无预测正向；第二次无预测被拒；预测越界被拒；成功 / 没成功与 failStreak；猜中计算；gate 通过、不通过各一条（契约 §七）
- simulate.js：让每个虚拟学生发一次 student:test（一组权重与线），收到本人 stage:my-data 且 tests 增加即完成
