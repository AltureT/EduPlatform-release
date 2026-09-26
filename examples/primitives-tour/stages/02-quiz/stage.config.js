// 原语版小测验：只有配置。showResultTo 'reveal'：学生提交后等教师在演示页点"揭晓"才看到得分与答案。
export default {
  id: 'prime-quiz',
  label: '质数小测',
  primitive: 'quiz',
  options: {
    items: [
      {
        id: 'q1', type: 'single', question: '下列哪个数是质数？',
        choices: ['21', '27', '29', '33'], answer: 'C',
        explain: '29 只能被 1 和它本身整除；21、27、33 都能被 3 整除',
      },
      {
        id: 'q2', type: 'truefalse', question: '1 是质数。', answer: false,
        explain: '质数要求大于 1，1 既不是质数也不是合数',
      },
      { id: 'q3', type: 'blank', question: '最小的质数是？', answer: ['2', '二'] },
    ],
    showResultTo: 'reveal',
    gate: { submitted: 0.7, soft: true },
  },
};
