// 感知：用原语 vote，options 见 primitives/vote/README.md。短信原文放 prompt（标题下的正文），question 只留一句问题。
export default {
  id: 'perceive',
  label: '感知',
  primitive: 'vote',
  options: {
    question: '这条短信是诈骗还是正常？',
    prompt: '【快递中心】尊敬的客户：您的快递（单号 YT7730****1826）在运输途中丢失，我司将按商品价格 3 倍为您理赔。\n请点击 kd-lp.cn/x8q 填写银行卡号和手机验证码办理，24 小时内有效，逾期视为自动放弃。',
    choices: ['诈骗', '正常'],
    answer: 'A',
    canChange: false,
    gate: { submitted: 'all', soft: false },
    idleAlertMs: 0,
  },
};
