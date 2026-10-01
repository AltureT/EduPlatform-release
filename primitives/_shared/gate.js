// 声明式门槛（活动原语规格 §2.5）：options.gate → gate(ctx) 函数。只给原语用，阶段不直接引用。
//
//   false                          不设门槛（恒 ok）
//   { submitted: 0.7, soft: true } 在线学生里"已提交"的比例 ≥ 70%
//   { submitted: 'all' }           全部在线学生都满足；soft 缺省 false（硬门槛，教师端需再点一次确认）
//   { correct: 0.6 }               有 answer 的原语：答对 ≥ 60%；口径由原语决定：vote 人数比、quiz 平均比率（见下）
//   { ran } / { testsPassed } / { image }   code / data-analysis 专用；谓词由各原语提供
//                                  （ran 叫"跑通"：跑过且最近一次无报错，与统计页的"已运行"区分）
//   submitted 的谓词也由原语提供：code / data-analysis（P3）里是"上交过最终稿"（记录有 finalAt），自动运行记录不算
//
// 每个 spec 只写一个指标键（加可选 soft）；比例取 (0, 1] 或 'all'。分母 = ctx.state.connected()（离线不计），
// 两种口径（由原语给的谓词决定，各原语 README 写明）：
//   人数比（缺省）：predicates[指标] 是函数 record → 真假；分子 = 在线学生里为真的人数；阈值 = ceil(在线人数 × 比例)，
//                   与 minimal 手写 gate 一致（vote 的 correct、code 的 testsPassed 等）
//   平均比率（K10）：predicates[指标] 写成 averageOf(fn, label?)，fn(record) 返回 0–1（截到 0–1，非数当 0，未作答通常返回 0）；
//                   在线学生取平均 ≥ 比例（'all' = 1）即达标（quiz 的 correct = 平均得分率）；没有在线学生时 ok

export const GATE_METRICS = ['submitted', 'correct', 'ran', 'testsPassed', 'image'];

const LABEL = {
  submitted: '已提交',
  correct: '答对',
  ran: '跑通',
  testsPassed: '测试全过',
  image: '已出图',
};

// 平均比率写法：label 是未达标提示里的名字（缺省"平均<指标名>率"，如"平均答对率"）
export function averageOf(fn, label) {
  if (typeof fn !== 'function') throw new Error('averageOf 需要一个 record → 0–1 的函数');
  return { average: fn, label: typeof label === 'string' && label ? label : null };
}

const clamp01 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

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

// predicates = { submitted(record), correct?(record), ran?(record), testsPassed?(record), image?(record) }，
// 每项是函数（人数比）或 averageOf(fn)（平均比率）
export function declarativeGate(spec, predicates) {
  if (spec === false) return function gateOff() { return { ok: true }; };
  validateGateSpec(spec);
  const metric = GATE_METRICS.find((k) => k in spec);
  const pred = predicates && predicates[metric];
  const avg = isPlainObject(pred) && typeof pred.average === 'function' ? pred : null;
  if (typeof pred !== 'function' && !avg) throw new Error(`gate.${metric} 不适用于这个原语（没有对应的判断）`);
  const ratio = spec[metric];
  const soft = spec.soft === true;
  const pct = ratio === 'all' ? 100 : Math.round(ratio * 100);
  if (avg) {
    const need = ratio === 'all' ? 1 : ratio;
    const label = avg.label ?? `平均${LABEL[metric]}率`;
    return function gate(ctx) {
      const connected = ctx.state.connected();
      if (connected.length === 0) return { ok: true };
      let sum = 0;
      for (const s of connected) sum += clamp01(avg.average(ctx.data.get(s.name)));
      const mean = sum / connected.length;
      if (mean + 1e-9 < need) return { ok: false, soft, reason: `${label} ${Math.round(mean * 100)}%，未到 ${pct}%` };
      return { ok: true };
    };
  }
  return function gate(ctx) {
    const connected = ctx.state.connected();
    const total = connected.length;
    const done = connected.filter((s) => pred(ctx.data.get(s.name))).length;
    const need = ratio === 'all' ? total : Math.ceil(total * ratio);
    if (done < need) return { ok: false, soft, reason: `${LABEL[metric]} ${done}/${total}，未到 ${pct}%` };
    return { ok: true };
  };
}
