// 段 1 · 第一段代码：打印九九乘法表前三行
export const TASK = '打印九九乘法表前三行';
const STARTER = '# 打印九九乘法表前三行\n';

const IDLE_MS = 5 * 60_000;

// 草稿里有运行痕迹：页面累计运行次数 > 0，或带回了输出 / 报错 / 测试（刷新后 runs 归零，但上次输出仍在）
const draftRan = (d) => !!d && ((d.runs ?? 0) > 0 || !!d.stdout || d.error != null || d.tests != null);
const ran = (s) => s.submittedAt != null || draftRan(s.draft);

const errorType = (error) => String(error).split(':')[0].trim();

export default {
  id: 'hello',
  label: '第一段代码',
  primitive: null,
  reviewInteractive: false,
  layout: 'split',             // 页面样式（契约 v0.7）：focus | split | tiles | table | stack

  sandbox: {
    starter: STARTER,
  },

  // E：在线学生提交率 ≥ 70%（草稿不算提交），软提示
  gate(ctx) {
    const connected = ctx.state.connected();
    const submitted = connected.filter((s) => ctx.data.get(s.name)?.submittedAt != null).length;
    if (submitted < Math.ceil(connected.length * 0.7)) {
      return { ok: false, soft: true, reason: `已提交 ${submitted}/${connected.length}，未到 70%` };
    }
    return { ok: true };
  },

  // C：§3.6 记录形状 + submittedAt；草稿在 draft 子记录里
  collect: {
    perStudent: { code: 'text', stdout: 'text', error: 'text', runs: 'integer', ms: 'integer', submittedAt: 'integer', draft: 'object' },
  },

  // 组件钩子：个人报告条目
  summarize(record) {
    if (record?.submittedAt == null) return [{ label: '提交', value: '未提交' }];
    return [
      { label: '运行次数', value: record.runs },
      { label: '提交结果', value: record.error ? errorType(record.error) : '运行无报错' },
    ];
  },

  alerts: [
    { id: 'idle', when: (s, now) => s.enteredStageAt != null && !ran(s) && now - s.enteredStageAt > IDLE_MS, text: '5 分钟未运行' },
  ],
};
