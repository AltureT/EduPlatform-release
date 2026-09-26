// 声明式门槛（活动原语规格 §2.5）：options.gate → gate(ctx) 函数。只给原语用，阶段不直接引用。
//
//   false                          不设门槛（恒 ok）
//   { submitted: 0.7, soft: true } 在线学生里"已提交"的比例 ≥ 70%
//   { submitted: 'all' }           全部在线学生都满足；soft 缺省 false（硬门槛，教师端需再点一次确认）
//   { correct: 0.6 }               有 answer 的原语：答对人数 / 在线人数 ≥ 60%
//   { ran } / { testsPassed } / { image }   code / data-analysis 专用；谓词由各原语提供
//                                  （ran 叫"跑通"：跑过且最近一次无报错，与统计页的"已运行"区分）
//   submitted 的谓词也由原语提供：code / data-analysis（P3）里是"上交过最终稿"（记录有 finalAt），自动运行记录不算
//
// 每个 spec 只写一个指标键（加可选 soft）；比例取 (0, 1] 或 'all'。分母 = ctx.state.connected()（离线不计），
// 分子 = 在线学生里 predicates[指标](record) 为真的人数；阈值 = ceil(在线人数 × 比例)，与 minimal 手写 gate 一致。

export const GATE_METRICS = ['submitted', 'correct', 'ran', 'testsPassed', 'image'];

const LABEL = {
  submitted: '已提交',
  correct: '答对',
  ran: '跑通',
  testsPassed: '测试全过',
  image: '已出图',
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 校验 spec 形状；allowed 为本原语能提供的指标（缺省全部）。不合法抛 Error（中文，前缀 gate）
export function validateGateSpec(spec, allowed = GATE_METRICS) {
  if (spec === false) return spec;
  if (!isPlainObject(spec)) throw new Error('gate 必须是 false 或 { submitted: 0.7, soft: true } 这样的对象');
  const metrics = [];
  for (const [k, v] of Object.entries(spec)) {
    if (k === 'soft') {
      if (typeof v !== 'boolean') throw new Error('gate.soft 必须是 true / false');
      continue;
    }
    if (!GATE_METRICS.includes(k)) throw new Error(`gate 不认识的键 ${k}（可用：${GATE_METRICS.join(' / ')}、soft）`);
    if (!allowed.includes(k)) throw new Error(`gate.${k} 不适用于这个原语（可用：${allowed.join(' / ')}）`);
    if (!(v === 'all' || (typeof v === 'number' && v > 0 && v <= 1))) {
      throw new Error(`gate.${k} 必须是 0 到 1 之间的比例（不含 0）或 'all'`);
    }
    metrics.push(k);
  }
  if (metrics.length !== 1) throw new Error(`gate 必须恰好写一个指标（${GATE_METRICS.join(' / ')}）`);
  return spec;
}

// predicates = { submitted(record), correct?(record), ran?(record), testsPassed?(record), image?(record) }
export function declarativeGate(spec, predicates) {
  if (spec === false) return function gateOff() { return { ok: true }; };
  validateGateSpec(spec);
  const metric = GATE_METRICS.find((k) => k in spec);
  const pred = predicates && predicates[metric];
  if (typeof pred !== 'function') throw new Error(`gate.${metric} 不适用于这个原语（没有对应的判断）`);
  const ratio = spec[metric];
  const soft = spec.soft === true;
  const pct = ratio === 'all' ? 100 : Math.round(ratio * 100);
  return function gate(ctx) {
    const connected = ctx.state.connected();
    const total = connected.length;
    const done = connected.filter((s) => pred(ctx.data.get(s.name))).length;
    const need = ratio === 'all' ? total : Math.ceil(total * ratio);
    if (done < need) return { ok: false, soft, reason: `${LABEL[metric]} ${done}/${total}，未到 ${pct}%` };
    return { ok: true };
  };
}
