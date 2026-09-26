// 原语版投票：只有配置（自写版见 examples/minimal/stages/01-vote）。写了 answer，教师在演示页点"揭晓"。
export default {
  id: 'prime-vote',
  label: '质数投票',
  primitive: 'vote',
  options: {
    question: '下列哪个数是质数？',
    choices: ['21', '27', '29', '33'],
    answer: 'C',
    canChange: true,
    gate: { submitted: 0.7, soft: true },
    idleAlertMs: 180_000,
  },
};
