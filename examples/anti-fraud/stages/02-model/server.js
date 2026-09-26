import { shape } from '#kernel/server/schema.js';
import { FEATURE_KEYS, MESSAGES, WEIGHT_MAX, scoreOf, step1Weights, verify } from './data.js';

// 权重对象只收 6 个特征键、0–WEIGHT_MAX 的整数；不合法返回一句原因
function checkWeights(weights) {
  const keys = Object.keys(weights);
  if (keys.some((k) => !FEATURE_KEYS.includes(k))) return '权重里有不认识的特征';
  for (const k of FEATURE_KEYS) {
    const v = weights[k];
    if (!Number.isInteger(v) || v < 0 || v > WEIGHT_MAX) return `权重要是 0–${WEIGHT_MAX} 的整数`;
  }
  return null;
}

export function register(ctx) {
  // 第一步：勾选特征，每个特征固定 20 分；可重复，以最后一次为准
  ctx.on('student:pick', shape({ features: `array:enum:${FEATURE_KEYS.join(',')}` }), (socket, payload, actor) => {
    const features = [...new Set(payload.features)];
    const w = step1Weights(features);
    ctx.data.set(actor.name, {
      step1Features: features,
      step1Scores: MESSAGES.map((m) => scoreOf(m, w)),
      step1At: Date.now(),
    });
  });

  // 第二步：教师放权后才能验证；可反复验证，以最后一次为准
  ctx.on('student:verify', shape({ weights: 'object' }), (socket, payload, actor) => {
    if (!ctx.data.getClass().released) return ctx.reject(socket, '老师还没放权');
    const bad = checkWeights(payload.weights);
    if (bad) return ctx.reject(socket, bad);
    const weights = Object.fromEntries(FEATURE_KEYS.map((k) => [k, payload.weights[k]]));
    const { scores, passed } = verify(weights);
    const prev = ctx.data.get(actor.name);
    ctx.data.set(actor.name, {
      weights,
      verifyScores: scores,
      passed,
      verifyCount: (prev?.verifyCount ?? 0) + 1,
      verifiedAt: Date.now(),
    });
  });

  // 教师放权：班级记录写 released；每个学生记录写 releasedAt（提醒用，不含姓名）；重复放权不改时间
  ctx.on('teacher:release', shape({}), () => {
    if (ctx.data.getClass().released) return;
    const releasedAt = Date.now();
    ctx.data.setClass({ released: true, releasedAt });
    for (const s of ctx.state.students()) ctx.data.set(s.name, { releasedAt });
  });
}
