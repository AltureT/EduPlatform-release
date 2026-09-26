# 计划 · 段 5 集体拦截（intercept）

## 事件
- 学生发：student:run { weights: { 特征键: 0–100 整数 }, threshold: 0–300 整数 } —— 学生页进入本段时自动发一次（学生不操作），权重与线取他第 4 段记录里最后一次检验的设置；服务端在 40 条统一测试短信上算四类各抓到几条、误拦几条、查全、查准、F1，写记录（契约 §三）；已跑过再发 → 覆盖（以最后一次为准）
- 学生第 4 段没有检验记录 → 学生页显示"第 4 段没有检验记录"，不发
- 教师发：无（邀请回答、邀请互助、推荐由平台默认的组件提供）
- 测试短信放本段目录 data.js：同一套 6 个特征、40 条（24 诈骗四类各 6、16 正常，与段 4 的 100 条不同），每条标类别与命中特征；算分函数

## 记录字段
- perStudent：recall（number）、precision（number）、f1（number）、blocked（integer，误拦数）、byType（object，四类各抓到几条 / 共几条）、blockedIds（array，误拦了哪几条正常短信的序号）、ranAt（integer）；perClass：无；不存学生姓名
- 个人报告条目：统一测试 F1（附全班中位数）、查全、查准、误拦数（summarize，契约 §二）

## 视图
- Student.jsx：<Page template="focus">；Main 放四类各一条进度条（抓到 / 共几条）与误拦几条、查全、查准、F1；读第 4 段设置用 useStudentStage('tune') 的 myData.last（只读，不 import 别的段）；无 Actions（契约 §四）
- TeacherStats.jsx：表格列 = D 栏：姓名、查全、查准、F1、误拦数，按 F1 降序（排行）；提醒 alerts：无
- TeacherDemo.jsx：要（A 栏"误拦反思"一页不是统计表）：<Page template="focus">，Main 放 16 条正常测试短信，每条后面是被多少人误拦，按人数降序

## 门槛
- E 栏"无门槛" → gate：恒 { ok: true }（契约 §二）
- recommend：F1 前 3（理由"F1 x"）与误拦最少且查全 ≥ 70% 的前 2（理由"误拦 n 条"）；score = f1

## 测试要点
- server.test.js：run 正向（结果与手算一致）；权重越界被拒；教师发被拒；gate 恒通过一条、另写一条"无记录时也通过"（契约 §七）
- simulate.js：让每个虚拟学生发一次 student:run（一组权重与线），收到本人 stage:my-data 即完成
