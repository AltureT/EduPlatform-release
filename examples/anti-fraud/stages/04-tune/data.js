// 段 4 的样本：6 个特征（与段 2 同一套）、100 条样本（60 条诈骗，四类各 15；40 条正常），每条标命中特征。视图与 server.js 都从这里取。
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

// 100 条样本（AI 编写，非真实短信）
export const SAMPLES = [
  { id: 1, type: "refund", text: "【快递客服】您的包裹丢失，点击 kd-pei.cn 填写银行卡号办理 3 倍理赔。", features: ["identity", "link", "askinfo"] },
  { id: 2, type: "refund", text: "【淘宝客服】您购买的商品质量不合格，我方主动退款 128 元，请点 tb-tk.cc 填写卡号和验证码。", features: ["identity", "link", "askinfo"] },
  { id: 3, type: "refund", text: "您好，我是京东售后，您的订单误开通会员，每月扣费 500 元，今天内点 jd-qx.top 取消，否则自动扣费。", features: ["identity", "link", "urgent"] },
  { id: 4, type: "refund", text: "【顺丰理赔中心】快递破损赔付 200 元，添加客服后提供银行卡号和收到的验证码即可到账。", features: ["identity", "askinfo"] },
  { id: 5, type: "refund", text: "【闲鱼客服】您的账户保证金未缴，交易被冻结，请 30 分钟内点 xy-bz.cn 验证银行卡。", features: ["identity", "link", "urgent", "askinfo"] },
  { id: 6, type: "refund", text: "亲，您的快递被海关扣留，需缴纳 300 元清关费，请转账至专员账户后放行。", features: ["identity", "transfer"] },
  { id: 7, type: "refund", text: "【航空公司】您预订的航班取消，改签补偿 400 元，请点 hk-gq.cn 填写卡号领取。", features: ["identity", "link", "askinfo"] },
  { id: 8, type: "refund", text: "【美团客服】您的外卖骑手险误扣费，点 mt-tk.cc 输入卡号与验证码退回。", features: ["identity", "link", "askinfo"] },
  { id: 9, type: "refund", text: "您好，您在抖音开通了百万保障，今日不关闭将每月扣 800 元，请联系客服 400-xxx 操作。", features: ["identity", "urgent"] },
  { id: 10, type: "refund", text: "【拼多多】您的退款失败，请在 2 小时内点 pdd-tk.top 重新提交银行卡信息。", features: ["identity", "link", "urgent", "askinfo"] },
  { id: 11, type: "refund", text: "【快递中心】您的件因地址不详被退回，点 kd-dz.cn 补填地址并支付 2 元运费。", features: ["identity", "link"] },
  { id: 12, type: "refund", text: "【银行】您的信用卡额度可提升至 5 万，请回复身份证号和卡号办理。", features: ["identity", "askinfo"] },
  { id: 13, type: "refund", text: "尊敬的用户，您的网购订单异常，客服将为您退款，请把手机收到的 6 位验证码告诉我。", features: ["identity", "askinfo"] },
  { id: 14, type: "refund", text: "【电商客服】商品召回补偿 150 元，今天截止，点 ds-zh.cn 登记银行卡。", features: ["identity", "link", "urgent", "askinfo"] },
  { id: 15, type: "refund", text: "您的快递理赔款已到，请下载会议软件共享屏幕，客服远程协助您领取。", features: ["identity"] },
  { id: 16, type: "task", text: "动动手指日赚三百！刷单返利，先垫付 100 元马上返 120，名额今天截止。", features: ["reward", "transfer", "urgent"] },
  { id: 17, type: "task", text: "招聘兼职：在家点赞关注，一单 5 元，日结 200+，加群 qz-jz.cn 领取任务。", features: ["reward", "link"] },
  { id: 18, type: "task", text: "恭喜入选高级任务，本轮需连做 3 单，垫付 2000 元，完成返 2600。", features: ["reward", "transfer"] },
  { id: 19, type: "task", text: "宝妈学生党福利！手机做任务，一小时赚 80，先交 99 元会员费开通。", features: ["reward", "transfer"] },
  { id: 20, type: "task", text: "点击 zq-rw.top 注册，完成首单立返 30 元红包，限时 24 小时。", features: ["reward", "link", "urgent"] },
  { id: 21, type: "task", text: "刷单任务差最后一单，垫付 5000 元即可一起提现 6800，超时清零！", features: ["reward", "transfer", "urgent"] },
  { id: 22, type: "task", text: "投资理财内部群，导师带单，日收益 10%，稳赚不赔，转账即可入群。", features: ["reward", "transfer"] },
  { id: 23, type: "task", text: "您已获得刷单资格，下载 APP 后按客服指导充值，佣金 30%。", features: ["reward", "transfer", "link"] },
  { id: 24, type: "task", text: "网店好评返现：下单后五星好评返 20 元，另有高佣任务等你。", features: ["reward"] },
  { id: 25, type: "task", text: "游戏代练日赚千元，先交 300 元押金，工作量少收入高。", features: ["reward", "transfer"] },
  { id: 26, type: "task", text: "点赞任务：关注 3 个账号截图即返 15 元，扫码 dz-rw.cn 进群。", features: ["reward", "link"] },
  { id: 27, type: "task", text: "恭喜获得双倍佣金，今晚 12 点前完成 5 单并充值 1000 元，否则资格作废。", features: ["reward", "transfer", "urgent"] },
  { id: 28, type: "task", text: "高薪招募打字员，每天 2 小时月入 8000，先交培训费 199 元。", features: ["reward", "transfer"] },
  { id: 29, type: "task", text: "您的任务账户被冻结，需再充值 3000 元解冻，才能提现全部佣金。", features: ["reward", "transfer", "urgent"] },
  { id: 30, type: "task", text: "内部渠道：虚拟币拉新奖励 500 元一人，点 xnb-lx.top 马上开始。", features: ["reward", "link"] },
  { id: 31, type: "police", text: "这里是市公安局，你涉嫌洗钱，请立即把资金转入安全账户配合调查。", features: ["identity", "transfer", "urgent"] },
  { id: 32, type: "police", text: "【检察院】你名下银行卡涉嫌违法，今天必须配合冻结，把存款转到清查账户。", features: ["identity", "transfer", "urgent"] },
  { id: 33, type: "police", text: "我是派出所民警，你的身份证被人冒用开卡，需提供银行卡号和验证码核实。", features: ["identity", "askinfo"] },
  { id: 34, type: "police", text: "【法院通知】你有一张传票未签收，逾期将强制执行，详情点 fy-cp.cn。", features: ["identity", "link", "urgent"] },
  { id: 35, type: "police", text: "你的快递内查出违禁品，海关已转交警方，请立即下载指定软件接受视频问询。", features: ["identity", "urgent"] },
  { id: 36, type: "police", text: "我是网警，你的账号涉及诈骗案，为证明清白请把余额转到监管账户。", features: ["identity", "transfer"] },
  { id: 37, type: "police", text: "【公安】你涉嫌参与跨境赌博，2 小时内不配合将上网通缉，请联系办案警官。", features: ["identity", "urgent"] },
  { id: 38, type: "police", text: "我是医保局工作人员，你的医保卡被异地盗刷，需转接公安并提供卡号。", features: ["identity", "askinfo"] },
  { id: 39, type: "police", text: "社保中心通知：你的社保卡已冻结，立即点 sb-jd.cn 输入卡号和密码解冻。", features: ["identity", "link", "urgent", "askinfo"] },
  { id: 40, type: "police", text: "我是刑警队长，此案保密，不得告诉家人，今天把钱转到安全账户做资金核查。", features: ["identity", "transfer", "urgent"] },
  { id: 41, type: "police", text: "【税务局】你有一笔个税未缴，今日缴纳可免滞纳金，点 sw-jn.top 缴款。", features: ["identity", "link", "urgent", "transfer"] },
  { id: 42, type: "police", text: "你的银行账户涉嫌洗钱被列入名单，请按警官指示把资金转出做清白证明。", features: ["identity", "transfer"] },
  { id: 43, type: "police", text: "我是市场监管局，你的网店被举报违法，需缴纳保证金 5000 元避免处罚。", features: ["identity", "transfer"] },
  { id: 44, type: "police", text: "通信管理局通知：你的手机号涉嫌发送诈骗短信，两小时后停机，按 9 转人工。", features: ["identity", "urgent"] },
  { id: 45, type: "police", text: "你涉嫌一起非法集资案，请把身份证照片和银行卡号发给办案民警核实。", features: ["identity", "askinfo"] },
  { id: 46, type: "friend", text: "我是你领导，明天来我办公室一趟。先帮我转 5000 元给一个客户，急用，晚点还你。", features: ["identity", "transfer", "urgent"] },
  { id: 47, type: "friend", text: "同学，我是小李，换号了。手机坏了急用钱，先借我 800 元转这个卡上。", features: ["identity", "transfer", "urgent"] },
  { id: 48, type: "friend", text: "儿子：妈，我手机掉水里了，这是同学手机，急需交 2000 元资料费，转这个账户。", features: ["identity", "transfer", "urgent"] },
  { id: 49, type: "friend", text: "老同学好久不见，我在外地出了点事，能借我 3000 元周转吗？", features: ["identity", "transfer"] },
  { id: 50, type: "friend", text: "我是你表哥，微信被限制了，帮我收一笔 5 万的钱，你先垫付手续费 500 元。", features: ["identity", "transfer"] },
  { id: 51, type: "friend", text: "王老师您好，我是某某家长，孩子在医院急需手术费，请先帮忙转 1 万元。", features: ["identity", "transfer", "urgent"] },
  { id: 52, type: "friend", text: "我是你们学校教务处，这学期补交教材费 260 元，今天前转到这个个人账户。", features: ["identity", "transfer", "urgent"] },
  { id: 53, type: "friend", text: "嗨，我是你朋友阿杰，在国外被扣护照，急需 2000 元，千万别告诉别人。", features: ["identity", "transfer", "urgent"] },
  { id: 54, type: "friend", text: "我是班主任，家长群缴费改到这个二维码，每人 180 元，今晚截止。", features: ["identity", "transfer", "urgent"] },
  { id: 55, type: "friend", text: "我是你舅舅的朋友，你舅舅让我找你借点钱，他现在不方便接电话。", features: ["identity", "transfer"] },
  { id: 56, type: "friend", text: "学长你好，社团活动经费差 600 元，你先帮垫一下转我，活动后退。", features: ["identity", "transfer"] },
  { id: 57, type: "friend", text: "老板：我在开会不方便接电话，财务那边你先按我说的账号转 2 万。", features: ["identity", "transfer"] },
  { id: 58, type: "friend", text: "是我呀，你猜我是谁？我换新号了，最近手头紧能不能借点钱。", features: ["identity", "transfer"] },
  { id: 59, type: "friend", text: "我是你室友小张，饭卡丢了，先借我 50 元，转我这个新号。", features: ["identity", "transfer"] },
  { id: 60, type: "friend", text: "我是你姑姑，在外地看病钱不够，你先转 3000 元过来，别跟你爸说。", features: ["identity", "transfer"] },
  { id: 61, type: "normal", text: "【学校】本学期教材费 86 元，请于周五前通过缴费平台 pay.school.cn 缴纳。", features: ["link", "transfer", "urgent"] },
  { id: 62, type: "normal", text: "妈妈：生活费转你微信了，记得查收。", features: ["transfer"] },
  { id: 63, type: "normal", text: "【菜鸟驿站】您的包裹已到小区驿站，取件码 3-2-1024，请今晚 21 点前取件。", features: ["urgent"] },
  { id: 64, type: "normal", text: "【某银行】您尾号 1234 的卡消费 58.00 元，余额 1300.25 元。", features: [] },
  { id: 65, type: "normal", text: "【12306】您购买的 G123 次列车已出票，请提前 30 分钟到站。", features: ["urgent"] },
  { id: 66, type: "normal", text: "周末班级聚餐，AA 每人 60 元，转给班长就行。", features: ["transfer"] },
  { id: 67, type: "normal", text: "【图书馆】您借阅的图书将于明天到期，请及时归还或续借 lib.edu.cn。", features: ["link", "urgent"] },
  { id: 68, type: "normal", text: "【中国移动】您本月话费账单 38 元，详情可登录 10086.cn 查询。", features: ["link"] },
  { id: 69, type: "normal", text: "明天上午第三节体育课改在室内，带好运动鞋。", features: [] },
  { id: 70, type: "normal", text: "【社区】本周六上午接种疫苗，请携带身份证到社区服务中心。", features: [] },
  { id: 71, type: "normal", text: "爸爸：给你转了 200 元，买参考书用。", features: ["transfer"] },
  { id: 72, type: "normal", text: "【学校】期中考试成绩已发布，可登录 edu.school.cn 查看。", features: ["link"] },
  { id: 73, type: "normal", text: "【电力公司】您家本月电费 126 元，请于 25 日前缴纳，可在官方 APP 缴费。", features: ["transfer", "urgent"] },
  { id: 74, type: "normal", text: "【快递】您的顺丰快递已签收，如有问题请联系官方客服 95338。", features: [] },
  { id: 75, type: "normal", text: "【银行】为保障资金安全，请勿向任何人透露验证码，本行不会索要。", features: [] },
  { id: 76, type: "normal", text: "班长：校服费每人 120 元，本周五前交到班长这里。", features: ["transfer", "urgent"] },
  { id: 77, type: "normal", text: "【医院】您预约的周三上午 9:00 门诊，请提前 15 分钟到达。", features: ["urgent"] },
  { id: 78, type: "normal", text: "【视频会员】您的会员将于 3 天后到期，续费请前往官方 APP。", features: ["urgent"] },
  { id: 79, type: "normal", text: "【外卖】您的订单已送达，祝您用餐愉快，评价可得积分。", features: ["reward"] },
  { id: 80, type: "normal", text: "【超市】会员日全场 9 折，积分可抵现，详情见 cs-hy.cn。", features: ["link", "reward"] },
  { id: 81, type: "normal", text: "奶奶：过年红包给你转过去了，好好学习。", features: ["transfer"] },
  { id: 82, type: "normal", text: "【学校】明天下雨，放学后请家长接送，注意安全。", features: [] },
  { id: 83, type: "normal", text: "【航空】您的航班 CA1234 登机口变更为 15 号，请留意广播。", features: ["identity"] },
  { id: 84, type: "normal", text: "【银行】您申请的信用卡已寄出，快递单号 SF123456，请注意查收。", features: ["identity"] },
  { id: 85, type: "normal", text: "物业通知：本月物业费 180 元，请在 10 号前通过物业 APP 缴纳。", features: ["transfer", "urgent"] },
  { id: 86, type: "normal", text: "【运营商】流量已用 80%，可登录官网 10010.cn 办理加油包。", features: ["link"] },
  { id: 87, type: "normal", text: "同学：明天的数学作业是第 45 页 1 到 8 题。", features: [] },
  { id: 88, type: "normal", text: "【学校】研学旅行费用 350 元，请于本周内在缴费平台 pay.school.cn 缴纳。", features: ["link", "transfer", "urgent"] },
  { id: 89, type: "normal", text: "【快递】您的包裹因地址不详暂存网点，请联系快递员 138xxxx 确认地址。", features: ["identity"] },
  { id: 90, type: "normal", text: "【政务服务】您的居住证已办好，请携带身份证到服务大厅领取。", features: ["identity"] },
  { id: 91, type: "normal", text: "【银行】您的账户存在风险交易已暂停，如非本人操作请拨打背面官方电话。", features: ["identity", "urgent"] },
  { id: 92, type: "normal", text: "爸爸：钱转给你了，交完报名费告诉我。", features: ["transfer"] },
  { id: 93, type: "normal", text: "【健身房】新年会员特惠，年卡立减 500 元，本周截止。", features: ["reward", "urgent"] },
  { id: 94, type: "normal", text: "【学校】家长会周四下午两点召开，请准时参加。", features: ["urgent"] },
  { id: 95, type: "normal", text: "【物流】您购买的书已发货，可点 wl-cx.cn 查看物流。", features: ["link"] },
  { id: 96, type: "normal", text: "【游戏】周年庆签到领限定皮肤，活动今晚结束。", features: ["reward", "urgent"] },
  { id: 97, type: "normal", text: "表姐：我在你家楼下，下来拿一下给你带的东西。", features: ["identity"] },
  { id: 98, type: "normal", text: "【水务】您家本月水费 32 元已自动扣款，详情登录 sw.gov.cn 查询。", features: ["link", "transfer"] },
  { id: 99, type: "normal", text: "【学校】请于今天放学前在 form.school.cn 填写返校信息登记。", features: ["link", "urgent"] },
  { id: 100, type: "normal", text: "【银行】尊敬的客户，您的理财产品今日到期，本金和收益已转入活期账户。", features: ["identity", "reward", "transfer"] },
];
