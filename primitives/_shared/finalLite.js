// K10：最终稿不随自动记录重复推送（code / data-analysis 共用；只给原语用）
//
// 记录（存储）形状不变：final { code, stdout, error, images, tests, at, … } 仍完整存在服务端，报告、导出、门槛、
// 教师 teacher:get-student-detail（统计页点行的 DetailModal）读到的都是完整记录。
// 变的只是推送：上交最终稿之后，每次自动记录（student:code-submit / student:data-submit）经 ctx.data.set 的 push 投影，
// 推给教师（stage:data-update）与本人（stage:my-data）的记录里 final 换成摘要——去掉 code / stdout / error / images / tests，
// 保留其余小字段（at、stale、afterSolution、mistake），加 lite: true。
// 被投屏（perClass.featured）的学生照推完整最终稿（大屏要显示）；投屏时服务端补推一次完整记录。
// 客户端：finalOf 对 lite 返回 null（大屏退回最近运行）；统计页行详情用 DetailModal 拉到的完整记录。

const HEAVY = ['code', 'stdout', 'error', 'images', 'tests'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const isLiteFinal = (f) => isPlainObject(f) && f.lite === true;

export function liteFinal(final) {
  const out = {};
  for (const [k, v] of Object.entries(final)) if (!HEAVY.includes(k)) out[k] = v;
  out.lite = true;
  return out;
}

// data.set 的 push 投影：有完整 final 且 keepFull() 为假时换成摘要（不改原记录）
export function pushLite(keepFull = () => false) {
  return (record) => (isPlainObject(record?.final) && !isLiteFinal(record.final) && !keepFull()
    ? { ...record, final: liteFinal(record.final) }
    : record);
}
