// 反思与迁移：用原语 free-text，options 见 primitives/free-text/README.md。
export default {
  id: 'reflect',
  label: '反思与迁移',
  primitive: 'free-text',
  options: {
    prompts: [
      {
        id: 'tradeoff',
        title: '今天你的模型误拦了哪条正常短信？如果你是反诈系统的设计者，怎么在少误拦和多拦截之间取舍？',
        min: 5,
        max: 300,
      },
      {
        id: 'family',
        title: '回家后你会怎么跟家里长辈讲"什么样的短信不能点"？写三条。',
        min: 5,
        max: 300,
      },
    ],
    canChange: true,
    gate: { submitted: 0.7, soft: true },
    idleAlertMs: 0,
  },
};
