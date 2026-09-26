import { shape } from '#kernel/server/schema.js';
import { FEATURE_KEYS, TEST_SET, WEIGHT_MAX, evaluate } from './data.js';

function checkWeights(weights) {
  if (Object.keys(weights).some((k) => !FEATURE_KEYS.includes(k))) return '权重里有不认识的特征';
  for (const k of FEATURE_KEYS) {
    const v = weights[k];
    if (!Number.isInteger(v) || v < 0 || v > WEIGHT_MAX) return `权重要是 0–${WEIGHT_MAX} 的整数`;
  }
  return null;
}

export function register(ctx) {
  // 学生页进入本段时自动发一次（学生不操作）：用他第 4 段最后一次的设置，在 40 条统一测试短信上跑；再发则覆盖
  ctx.on('student:run', shape({ weights: 'object', threshold: 'integer:0-300' }), (socket, payload, actor) => {
    const bad = checkWeights(payload.weights);
    if (bad) return ctx.reject(socket, bad);
    const weights = Object.fromEntries(FEATURE_KEYS.map((k) => [k, payload.weights[k]]));
    const { recall, precision, f1, blocked, byType, blockedIds } = evaluate(TEST_SET, weights, payload.threshold);
    ctx.data.set(actor.name, { recall, precision, f1, blocked, byType, blockedIds, ranAt: Date.now() });
  });
}
