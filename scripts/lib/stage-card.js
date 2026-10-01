// 阶段卡（STAGE.md）：模板与结构解析（L1）。模板取自阶段卡格式第四部分（docs/01-阶段卡格式.md）
//   STAGE_CARD_COLUMNS：五栏标题（A 展示 … E 推进条件）
//   parseStageCard(text) → { columns: { A: 行号 | null, … }, primitive: { line, value, token } | null }
//     token：匹配原语那一行开头的原语名（小写、连字符），写的是"无 / 自写 / 投票"等说明时为 null
//   stageCardTemplate({ n, label, primitive, layout }) → 新阶段的 STAGE.md 文本（new:stage 用）
import { findLine } from './lesson-source.js';

export const STAGE_CARD_COLUMNS = [
  { key: 'A', title: 'A 展示' },
  { key: 'B', title: 'B 学生做什么' },
  { key: 'C', title: 'C 采集' },
  { key: 'D', title: 'D 统计' },
  { key: 'E', title: 'E 推进条件' },
];

const PRIMITIVE_LINE = /^\*\*匹配原语\*\*(?:（[^）\n]*）|\([^)\n]*\))?\s*[：:][ \t]*(.*)$/m;

export function parseStageCard(text) {
  const columns = {};
  for (const c of STAGE_CARD_COLUMNS) columns[c.key] = findLine(text, new RegExp(`^\\*\\*${c.title}\\*\\*`, 'm'));
  const m = PRIMITIVE_LINE.exec(text);
  let primitive = null;
  if (m) {
    const value = m[1].trim();
    const t = /^[`'"]?([a-z][a-z0-9-]*)(?![A-Za-z0-9_])/.exec(value);
    primitive = { line: findLine(text, PRIMITIVE_LINE), value, token: t ? t[1] : null };
  }
  return { columns, primitive };
}

const CODE_LIMITS = `
**限制说明**（代码类阶段，AI 填，教师确认）：
- 测试内容学生可见：
- 本段是否用到 turtle / tkinter / pygame 等窗口类库（不可用，需改题）：
- 题目与初始代码是否会引导学生输入真名（不得）：
- 页面内容按磁贴摆放，不指定像素位置：
`;

// primitive：原语名，或 null（自写）
export function stageCardTemplate({ n, label, primitive, layout }) {
  const match = primitive ? primitive : '无（自写，primitive: null）';
  const code = primitive === 'code' || primitive === 'data-analysis';
  return `### 段 ${n} · ${label}（<起止时间>）

> 核心教学事件：一句话，学生在这段要"撞上"什么。

**A 展示**
- 大屏投什么：
- 学生屏幕看什么：
- 教师按什么按钮、在什么时点按：
- 教师是否需要看某个学生的实时画面 / 挑人上来讲：

**B 学生做什么**
- 动作是什么（选、拖、写、跑、提交）：
- 有几步，步与步之间是否有先后：
- 提交后能不能改：
- 做不对时平台给什么反馈（只说"为什么没成功"，不说"应该怎么做"）：

**C 采集**
- 记什么字段：
- 记到人、记到组、还是只记到班：
- 课后要不要回看 / 进个人报告：

**D 统计**
- 教师统计视图看哪几列：
- 什么情况要提醒教师走过去（例如连续两次失败、长时间不提交）：
- 要不要排行 / 推荐分享：

**E 推进条件**（AI 推导，教师确认）
- 教师按"下一段"时要满足：
- 不满足时：软提示（可强制推）/ 硬拦截：

**匹配原语**：${match}

**页面样式**：${layout}
${code ? CODE_LIMITS : ''}`;
}
