// 原语版自由作答：只有配置。教师在统计页点行 → "投到大屏"展示一份作答（署名）。
export default {
  id: 'prime-why',
  label: '说说理由',
  primitive: 'free-text',
  options: {
    prompts: [
      { id: 'why', title: '你是怎么判断一个数是不是质数的？', placeholder: '写出你的方法', min: 5, max: 200 },
      { id: 'ask', title: '关于质数，你还想知道什么？', max: 100 },
    ],
    canChange: true,
    gate: { submitted: 0.7, soft: true },
  },
};
