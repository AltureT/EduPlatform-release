// 认识四类诈骗短信：用原语 vote，options 见 primitives/vote/README.md。没有标准答案（不写 answer），只看大家怎么选。
export default {
  id: 'classify',
  label: '认识四类诈骗短信',
  primitive: 'vote',
  options: {
    question: '四类常见诈骗短信，选一类由你负责',
    choices: [
      '冒充客服退款：以"快递丢失理赔"为由，让你点链接填卡号',
      '刷单返利："动动手指日赚三百"，先给小甜头再让你垫资',
      '冒充公检法："你涉嫌洗钱，配合调查"，让你把钱转到"安全账户"',
      '冒充熟人："我是你领导 / 同学，急用钱"，让你借钱转账',
    ],
    canChange: false,
    gate: { submitted: 'all', soft: false },
    idleAlertMs: 0,
  },
};
