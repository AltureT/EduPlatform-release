// 段 2 的题目数据：6 个特征、5 条示例短信（3 诈骗、2 正常，命中特征固定）。视图与 server.js 都从这里取。
export const FEATURES = [
  { key: 'link', label: '含链接' },
  { key: 'urgent', label: '催促限时' },
  { key: 'transfer', label: '转账汇款' },
  { key: 'identity', label: '冒充身份' },
  { key: 'reward', label: '高额回报' },
  { key: 'askinfo', label: '索要卡号验证码' },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

export const MESSAGES = [
  { id: 'm1', scam: true, text: '【快递客服】您的包裹运输中丢失，点击链接填写银行卡号和验证码，办理 3 倍理赔。', features: ['identity', 'link', 'askinfo'] },
  { id: 'm2', scam: true, text: '动动手指日赚三百！刷单返利，先垫付 100 元马上返 120，名额今天截止。', features: ['reward', 'transfer', 'urgent'] },
  { id: 'm3', scam: true, text: '这里是市公安局，你涉嫌洗钱，请立即把资金转入安全账户配合调查。', features: ['identity', 'transfer', 'urgent'] },
  { id: 'm4', scam: false, text: '【学校】本学期教材费 86 元，请于周五前通过缴费平台 pay.school.cn 缴纳。', features: ['link', 'transfer', 'urgent'] },
  { id: 'm5', scam: false, text: '妈妈：生活费转你微信了，记得查收。', features: ['transfer'] },
];

export const LINE = 60;
export const STEP1_WEIGHT = 20;
export const WEIGHT_MAX = 100;

// 一条短信的得分 = 命中特征的权重之和
export function scoreOf(message, weights) {
  return message.features.reduce((sum, k) => sum + (Number(weights?.[k]) || 0), 0);
}

// 第一步：勾选的特征每个 20 分
export function step1Weights(features) {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, features.includes(k) ? STEP1_WEIGHT : 0]));
}

// 验证：3 条诈骗都 ≥ 60、2 条正常都 < 60
export function verify(weights) {
  const scores = MESSAGES.map((m) => scoreOf(m, weights));
  const passed = MESSAGES.every((m, i) => (m.scam ? scores[i] >= LINE : scores[i] < LINE));
  return { scores, passed };
}
