// 作品墙服务端（课程本地组件规格 §7、§11 D1；写法见 docs/06-组件契约.md）
// 整面墙只发给教师（定向发送，不进班级记录）；全班只收到放大的那一张（perClass.spotlight）。
// 事件（t- 只收教师 socket）：
//   gallery:t-open {}：当前段 stage.config 顶层 gallery 为真才可以；读来源段（options.source，缺省 'score-analysis'）全部记录，
//     每人取最近记录的第一张图（最近运行优先，没有再看最终稿）→ emitTeachers('gallery:wall', { wall: [{ name, image, at }], skipped, openedAt })
//     （按出图先后；≤ 60 人、每张 ≤ 100 KB，超出的跳过并计入 skipped）；perClass.spotlight 清空
//   gallery:t-spotlight { name? }：从来源段重新取该生的图（没有或超过 100 KB → 拒绝）→ perClass.spotlight = { name, image, at }，
//     该生 perStudent.shown += 1（重复点同一人不加）；name 缺省 / null → perClass.spotlight = null
//   gallery:t-close {}：perClass.spotlight = null，emitTeachers('gallery:closed', {})（教师端收起墙）
// 钩子：换段、重置课堂同 t-close。报告：report(name) → [{ label: '我的图被展示过', value: 'N 次' }]
// 班级记录只有 spotlight 一个键（一张图），每次 setClass 下发给全班的就只有这一张
import { shape } from '#kernel/server/schema.js';

export const LIMITS = Object.freeze({ people: 60, imageBytes: 100 * 1024 });
export const DEFAULT_SOURCE = 'score-analysis';
export const MSG = Object.freeze({
  notHere: '这一段没有开作品墙',
  noSource: '找不到作品来源的段',
  noImage: (name) => `${name} 没有可以展示的图`,
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const firstImage = (r) => (isPlainObject(r) && Array.isArray(r.images) && typeof r.images[0] === 'string' ? r.images[0] : null);

// 每人最近记录的第一张图：最近一次运行（submittedAt）有图就用它，否则用最终稿（final.at）
export function pickImage(record) {
  const run = firstImage(record);
  if (run) return { image: run, at: record.submittedAt ?? record.updatedAt ?? 0 };
  const fin = isPlainObject(record?.final) ? record.final : null;
  const img = firstImage(fin);
  return img ? { image: img, at: fin.at ?? record.finalAt ?? 0 } : null;
}

// 全班记录 → { wall, skipped }：按出图先后；base64 字符数即字节上限的近似（≥ 实际字节）
export function buildWall(perStudent, limits = LIMITS) {
  const picked = [];
  let skipped = 0;
  for (const [name, record] of Object.entries(perStudent ?? {})) {
    const p = pickImage(record);
    if (!p) continue;
    if (p.image.length > limits.imageBytes) {
      skipped += 1;
      continue;
    }
    picked.push({ name, image: p.image, at: p.at });
  }
  picked.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
  skipped += Math.max(0, picked.length - limits.people);
  return { wall: picked.slice(0, limits.people), skipped };
}

export const galleryOn = (config) => config?.gallery === true;

export function register(cctx) {
  const source = typeof cctx.options?.source === 'string' ? cctx.options.source : DEFAULT_SOURCE;
  const stageOf = (id) => cctx.stages.list().find((s) => s.id === id) ?? null;
  const close = () => {
    cctx.data.setClass({ spotlight: null });
    cctx.emitTeachers('gallery:closed', {});
  };

  cctx.on('gallery:t-open', shape({}), (socket) => {
    if (!galleryOn(stageOf(cctx.state.currentStage)?.config)) return cctx.reject(socket, MSG.notHere);
    if (!stageOf(source)) return cctx.reject(socket, MSG.noSource);
    const { wall, skipped } = buildWall(cctx.stages.data(source).all());
    if (cctx.data.getClass()?.spotlight != null) cctx.data.setClass({ spotlight: null });
    cctx.emitTeachers('gallery:wall', { wall, skipped, openedAt: Date.now() });
    return undefined;
  });

  cctx.on('gallery:t-spotlight', shape({ name: 'optional:string:1-64' }), (socket, { name }) => {
    if (name == null) {
      cctx.data.setClass({ spotlight: null });
      return undefined;
    }
    if (cctx.data.getClass()?.spotlight?.name === name) return undefined;
    const p = stageOf(source) ? pickImage(cctx.stages.data(source).get(name)) : null;
    if (!p || p.image.length > LIMITS.imageBytes) return cctx.reject(socket, MSG.noImage(name));
    cctx.data.setClass({ spotlight: { name, image: p.image, at: Date.now() } });
    const shown = Number(cctx.data.get(name)?.shown) || 0;
    cctx.data.set(name, { shown: shown + 1 });
    return undefined;
  });

  cctx.on('gallery:t-close', shape({}), () => close());

  cctx.hooks.onStageChange(() => close());
  cctx.hooks.onReset(() => close());
}

export function report(name, cctx) {
  const n = Number(cctx.data.get(name)?.shown) || 0;
  return [{ label: '我的图被展示过', value: `${n} 次` }];
}
