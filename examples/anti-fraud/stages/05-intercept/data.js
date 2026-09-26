// 段 5 的统一测试短信：同一套 6 个特征、40 条（24 条诈骗四类各 6、16 条正常），与段 4 的 100 条不同。视图与 server.js 都从这里取。
export const FEATURES = [
  { key: 'link', label: '含链接' },
  { key: 'urgent', label: '催促限时' },
  { key: 'transfer', label: '转账汇款' },
  { key: 'identity', label: '冒充身份' },
  { key: 'reward', label: '高额回报' },
  { key: 'askinfo', label: '索要卡号验证码' },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

export const TYPES = [
  { key: 'refund', label: '冒充客服退款' },
  { key: 'task', label: '刷单返利' },
  { key: 'police', label: '冒充公检法' },
  { key: 'friend', label: '冒充熟人' },
];

export const WEIGHT_MAX = 100;
export const THRESHOLD_MAX = 300;

// 一条短信的得分 = 命中特征的权重之和；得分 ≥ 线 就拦截
export function scoreOf(sample, weights) {
  return sample.features.reduce((sum, k) => sum + (Number(weights?.[k]) || 0), 0);
}

// 在一组样本上算：抓到几条诈骗、误拦几条正常、查全、查准、F1（保留两位小数）
export function evaluate(samples, weights, threshold) {
  let caught = 0;
  let blocked = 0;
  const scamTotal = samples.filter((s) => s.type !== 'normal').length;
  const byType = Object.fromEntries(TYPES.map((t) => [t.key, { caught: 0, total: 0 }]));
  const blockedIds = [];
  for (const s of samples) {
    const hit = scoreOf(s, weights) >= threshold;
    if (s.type === 'normal') {
      if (hit) {
        blocked += 1;
        blockedIds.push(s.id);
      }
    } else {
      byType[s.type].total += 1;
      if (hit) {
        caught += 1;
        byType[s.type].caught += 1;
      }
    }
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  const recall = scamTotal ? caught / scamTotal : 0;
  const precision = caught + blocked ? caught / (caught + blocked) : 0;
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  return { caught, blocked, recall: round2(recall), precision: round2(precision), f1: round2(f1), byType, blockedIds };
}

// 40 条统一测试短信（AI 编写，非真实短信）
export const TEST_SET = [
  { id: 1, type: "refund", text: "【客服中心】您的订单物流异常，理赔 99 元请点 lp-kf.cn 填银行卡号。", features: ["identity", "link", "askinfo"] },
  { id: 2, type: "refund", text: "【唯品会】商品下架补偿，请告知收到的验证码完成退款。", features: ["identity", "askinfo"] },
  { id: 3, type: "refund", text: "您好，我是快递公司客服，您的件丢了，加我好友给您双倍赔偿。", features: ["identity"] },
  { id: 4, type: "refund", text: "【某平台】您的百万医疗险今日到期自动续费 1200 元，点 bx-qx.top 取消。", features: ["identity", "link", "urgent"] },
  { id: 5, type: "refund", text: "【电商售后】退款 66 元需先验证账户，请在 10 分钟内提供卡号和验证码。", features: ["identity", "urgent", "askinfo"] },
  { id: 6, type: "refund", text: "【快递】您的包裹违规被扣，缴纳 50 元罚金后放行，转账给专员。", features: ["identity", "transfer"] },
  { id: 7, type: "task", text: "手机兼职，看视频点赞一单 3 元，日入 300，先交 88 元入门费。", features: ["reward", "transfer"] },
  { id: 8, type: "task", text: "恭喜您获得返利资格，充值 500 返 650，名额仅剩 3 个！", features: ["reward", "transfer", "urgent"] },
  { id: 9, type: "task", text: "高回报项目，导师带你炒币，月收益 50%，扫码 cb-dx.cn 入群。", features: ["reward", "link"] },
  { id: 10, type: "task", text: "点赞员招募，一小时 60 元，点 dz-zm.cn 报名。", features: ["reward", "link"] },
  { id: 11, type: "task", text: "最后一单完成即可提现全部 8000 元佣金，请在 1 小时内充值 3000 元。", features: ["reward", "transfer", "urgent"] },
  { id: 12, type: "task", text: "网店刷信誉，买一单返一单本金加 20 元佣金。", features: ["reward", "transfer"] },
  { id: 13, type: "police", text: "我是公安局民警，你涉嫌一起电信诈骗案，请把存款转到安全账户接受审查。", features: ["identity", "transfer"] },
  { id: 14, type: "police", text: "【法院】你有未结案件，今天下午前不处理将被拘留，点 fy-aj.cn 查看。", features: ["identity", "link", "urgent"] },
  { id: 15, type: "police", text: "我是反诈中心的，你的银行卡已被诈骗团伙控制，请提供卡号和验证码帮你冻结。", features: ["identity", "askinfo"] },
  { id: 16, type: "police", text: "【公积金中心】你的公积金账户异常，立即点 gjj-yz.cn 验证卡号密码。", features: ["identity", "link", "urgent", "askinfo"] },
  { id: 17, type: "police", text: "我是检察官，你的案子需要保密，今天把 2 万元转到监管账户。", features: ["identity", "transfer", "urgent"] },
  { id: 18, type: "police", text: "出入境管理局：你的护照涉嫌被盗用，请配合警方视频笔录。", features: ["identity"] },
  { id: 19, type: "friend", text: "我是你班主任，家长群改了，资料费 150 元转到这个账号，今天截止。", features: ["identity", "transfer", "urgent"] },
  { id: 20, type: "friend", text: "老同学，我在医院急需押金 5000 元，能先借我吗？", features: ["identity", "transfer", "urgent"] },
  { id: 21, type: "friend", text: "我是你领导，帮我给这个账户转 3 万，我开会不方便。", features: ["identity", "transfer"] },
  { id: 22, type: "friend", text: "哥，我换号了，给我转 200 元，晚上还你。", features: ["identity", "transfer"] },
  { id: 23, type: "friend", text: "我是你小姨，刚到你们城市钱包丢了，先转我 1000 元。", features: ["identity", "transfer", "urgent"] },
  { id: 24, type: "friend", text: "我是学生会的，活动报名费 30 元转给我个人就行。", features: ["identity", "transfer"] },
  { id: 25, type: "normal", text: "【学校】下周一开学典礼，请穿校服准时到操场集合。", features: ["urgent"] },
  { id: 26, type: "normal", text: "妈妈：给你转了 300 元，周末回家注意安全。", features: ["transfer"] },
  { id: 27, type: "normal", text: "【驿站】您的快递已到，取件码 5-1-2233。", features: [] },
  { id: 28, type: "normal", text: "【银行】您尾号 5678 的卡收入 500.00 元。", features: [] },
  { id: 29, type: "normal", text: "【学校】春游费用 120 元，请本周五前在缴费平台 pay.school.cn 缴纳。", features: ["link", "transfer", "urgent"] },
  { id: 30, type: "normal", text: "【运营商】本月账单已出，可登录官网 10086.cn 查询。", features: ["link"] },
  { id: 31, type: "normal", text: "班长：班费每人 30 元，这周交给我。", features: ["transfer", "urgent"] },
  { id: 32, type: "normal", text: "【医院】检查报告已出，可在官方 APP 查看。", features: [] },
  { id: 33, type: "normal", text: "【银行】您的定期存款今日到期，本息已转入活期账户。", features: ["identity", "transfer"] },
  { id: 34, type: "normal", text: "【视频平台】签到 7 天送会员，今天是最后一天。", features: ["reward", "urgent"] },
  { id: 35, type: "normal", text: "爸爸：给你转了学费，记得交。", features: ["transfer"] },
  { id: 36, type: "normal", text: "【图书馆】您预约的图书已到馆，请 3 天内到 lib.edu.cn 确认。", features: ["link", "urgent"] },
  { id: 37, type: "normal", text: "【快递】您的快递因地址不详，快递员将电话联系您。", features: ["identity"] },
  { id: 38, type: "normal", text: "【社区】燃气安全检查本周进行，请家中留人。", features: ["urgent"] },
  { id: 39, type: "normal", text: "【商场】会员积分即将清零，可到服务台兑换礼品。", features: ["reward", "urgent"] },
  { id: 40, type: "normal", text: "【学校】请家长在 form.school.cn 确认孩子午餐预订。", features: ["link"] },
];
