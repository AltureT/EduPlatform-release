// 段 2 · 数据与图：读 scores.csv 画各科平均分柱状图（中文标签）
export const TASK = '读 scores.csv，画各科平均分柱状图（中文标签）';

// 编号为虚构代号，不含真名
export const SCORES_CSV = [
  '编号,语文,数学,英语',
  'S01,86,92,78',
  'S02,74,68,81',
  'S03,91,85,88',
  'S04,65,72,70',
  'S05,88,95,90',
  'S06,79,81,76',
  'S07,93,77,85',
  'S08,70,64,69',
  'S09,82,89,91',
  'S10,77,73,80',
  'S11,95,98,94',
  'S12,68,70,62',
].join('\n') + '\n';

const STARTER = "import pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.read_csv('scores.csv')\nprint(df.head())\n";

const IDLE_MS = 8 * 60_000;
const hasImage = (r) => Array.isArray(r?.images) && r.images.length > 0;

export default {
  id: 'data',
  label: '数据与图',
  primitive: null,
  reviewInteractive: false,
  layout: 'split',             // 页面样式（契约 v0.7）：focus | split | tiles | table | stack

  sandbox: {
    packages: ['pandas', 'matplotlib'],
    files: { 'scores.csv': SCORES_CSV },
    starter: STARTER,
  },

  // E：在线学生提交率 ≥ 70%，软提示
  gate(ctx) {
    const connected = ctx.state.connected();
    const submitted = connected.filter((s) => ctx.data.get(s.name)?.submittedAt != null).length;
    if (submitted < Math.ceil(connected.length * 0.7)) {
      return { ok: false, soft: true, reason: `已提交 ${submitted}/${connected.length}，未到 70%` };
    }
    return { ok: true };
  },

  collect: {
    perStudent: { code: 'text', stdout: 'text', error: 'text', images: 'array', runs: 'integer', ms: 'integer', submittedAt: 'integer' },
  },

  // 组件钩子：个人报告条目——是否出图、全班出图人数
  summarize(record, { perStudent } = {}) {
    const withImage = Object.values(perStudent ?? {}).filter((r) => r?.submittedAt != null && hasImage(r)).length;
    return [
      { label: '是否出图', value: hasImage(record) ? '是' : '否' },
      { label: '全班出图人数', value: withImage },
    ];
  },

  alerts: [
    { id: 'idle', when: (s, now) => s.submittedAt == null && s.enteredStageAt != null && now - s.enteredStageAt > IDLE_MS, text: '8 分钟未提交' },
    { id: 'no-image', when: (s) => s.submittedAt != null && !hasImage(s), text: '提交了但没有图' },
  ],
};
