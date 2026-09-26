import { shape } from '#kernel/server/schema.js';
import { FEATURE_KEYS, SAMPLES, WEIGHT_MAX, evaluate } from './data.js';

export const HISTORY_MAX = 200; // 一段 7 分钟用不到这么多次，只防记录无限变大
const TRENDS = ['up', 'down', 'same'];

// 成功标准（教师定）：抓到的诈骗 ≥ 七成，且误拦正常短信 ≤ 5 条
export function judge(result) {
  const reasons = [];
  if (result.recall < 0.7) reasons.push('抓到的诈骗不到七成');
  if (result.blocked > 5) reasons.push('误拦正常短信超过 5 条');
  return { success: reasons.length === 0, failReason: reasons.length ? reasons.join('；') : null };
}

// 与上次比：差值 > 0.02 为升，< -0.02 为降，否则差不多
export function trendOf(now, before) {
  const d = now - before;
  if (d > 0.02) return 'up';
  if (d < -0.02) return 'down';
  return 'same';
}

// 猜中哪几项：抓到几条 ±3、误拦几条 ±2 算猜中；两个升降只在有上一次时比（没有上一次记 null，不算猜中）
export function hitItems(predict, result, prevLast) {
  const actualRecall = prevLast ? trendOf(result.recall, prevLast.recall) : null;
  const actualPrecision = prevLast ? trendOf(result.precision, prevLast.precision) : null;
  return {
    caught: Math.abs(predict.caught - result.caught) <= 3,
    blocked: Math.abs(predict.blocked - result.blocked) <= 2,
    recallTrend: actualRecall == null ? null : predict.recallTrend === actualRecall,
    precisionTrend: actualPrecision == null ? null : predict.precisionTrend === actualPrecision,
    actual: { recallTrend: actualRecall, precisionTrend: actualPrecision },
  };
}

export function countHits(predict, result, prevLast) {
  const h = hitItems(predict, result, prevLast);
  return [h.caught, h.blocked, h.recallTrend, h.precisionTrend].filter((x) => x === true).length;
}

function checkWeights(weights) {
  if (Object.keys(weights).some((k) => !FEATURE_KEYS.includes(k))) return '权重里有不认识的特征';
  for (const k of FEATURE_KEYS) {
    const v = weights[k];
    if (!Number.isInteger(v) || v < 0 || v > WEIGHT_MAX) return `权重要是 0–${WEIGHT_MAX} 的整数`;
  }
  return null;
}

// 预测：空对象 = 没填；填了就四项都要合法
function checkPredict(predict) {
  const keys = Object.keys(predict);
  if (keys.length === 0) return { none: true };
  const { caught, blocked, recallTrend, precisionTrend } = predict;
  if (keys.some((k) => !['caught', 'blocked', 'recallTrend', 'precisionTrend'].includes(k))) return { error: '预测里有不认识的项' };
  if (!Number.isInteger(caught) || caught < 0 || caught > 60) return { error: '预测"抓到几条"要是 0–60 的整数' };
  if (!Number.isInteger(blocked) || blocked < 0 || blocked > 40) return { error: '预测"误拦几条"要是 0–40 的整数' };
  if (!TRENDS.includes(recallTrend) || !TRENDS.includes(precisionTrend)) return { error: '预测的升降没选' };
  return { none: false };
}

export function register(ctx) {
  // 检验：可无限次，以最后一次为准；第一次可以不填预测，之后必须填 4 项
  ctx.on('student:test', shape({ weights: 'object', threshold: 'integer:0-300', predict: 'object' }), (socket, payload, actor) => {
    const bad = checkWeights(payload.weights);
    if (bad) return ctx.reject(socket, bad);
    const p = checkPredict(payload.predict);
    if (p.error) return ctx.reject(socket, p.error);
    const prev = ctx.data.get(actor.name);
    const tests = prev?.tests ?? 0;
    if (tests > 0 && p.none) return ctx.reject(socket, '先填 4 项预测');

    const weights = Object.fromEntries(FEATURE_KEYS.map((k) => [k, payload.weights[k]]));
    const { caught, blocked, recall, precision, f1 } = evaluate(SAMPLES, weights, payload.threshold);
    const result = { caught, blocked, recall, precision, f1 };
    const { success, failReason } = judge(result);
    const items = p.none ? null : hitItems(payload.predict, result, prev?.last);
    const hits = items ? [items.caught, items.blocked, items.recallTrend, items.precisionTrend].filter((x) => x === true).length : null;
    const predict = p.none ? null : payload.predict;
    const at = Date.now();
    const setting = { weights, threshold: payload.threshold };
    ctx.data.set(actor.name, {
      tests: tests + 1,
      last: { ...setting, ...result, success, at, predict, hits, hitItems: items },
      history: [...(prev?.history ?? []), { ...setting, ...result, success, predict, hits, at }].slice(-HISTORY_MAX),
      bestF1: Math.max(prev?.bestF1 ?? 0, f1),
      predicted: (prev?.predicted ?? 0) + (p.none ? 0 : 1),
      hitsTotal: (prev?.hitsTotal ?? 0) + (hits ?? 0),
      failStreak: success ? 0 : (prev?.failStreak ?? 0) + 1,
      failReason,
      testedAt: at,
    });
  });
}
