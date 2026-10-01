// 作品墙客户端（课程本地组件规格 §7、§11 D1；写法见 docs/06-组件契约.md）
// 教师端：teacherToolbar——当前段（currentStage，不是教师正在查看的段；服务端也只认当前段）gallery 为真时显示按钮"作品墙 (N)"（N = 来源段里出过图的人数），点一下发 gallery:t-open；
//   整面墙由服务端定向发给教师（gallery:wall），存在教师端本地切片（store.teacher），不进班级记录；
//   刷新页面后切片清空、墙收起，再点一次按钮即可重取；gallery:closed（关闭、换段、重置）收起。
//   teacherOverlay——墙打开时（切片 openedAt）Overlay 里 Tiles 网格，每张 Card 标名字、图等比缩放，点一张 → gallery:t-spotlight；
//   放大时显示 perClass.spotlight 那一张与"返回"；"关闭"发 gallery:t-close。
// 学生端：studentOverlay——perClass.spotlight（{ name, image, at }）有值时全体看到放大的那张（组件 options.anonymous 为真时不显示名字）；
//   studentAside——gallery 为真的段在题目栏下方一行提示（验证 studentAside 槽位）；学生端没有打开作品墙的入口。
import {
  useComponent, Btn, Card, Overlay, Row, Stack, Tiles,
} from '#kernel/client/index.js';
import { useGalleryStage } from './stageConfig.js';

const ID = 'gallery';
export const DEFAULT_SOURCE = 'score-analysis';
export const TEXT = Object.freeze({
  button: (n) => `作品墙 (${n})`,
  title: '作品墙',
  close: '关闭',
  back: '返回',
  empty: '还没有人出图',
  skipped: (n) => `${n} 张没放上来（图太大或人数超过 60）`,
  aside: '作品会上作品墙，画好后点运行',
  spotlightOf: (name) => `${name} 的图`,
  spotlightAnon: '同学的图',
});

const imgStyle = { display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto', background: 'var(--surface)', borderRadius: 'var(--radius-sm)' };
const cardBtn = {
  display: 'block', width: '100%', padding: 0, background: 'none', border: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer',
};
const src = (image) => `data:image/png;base64,${image}`;
const hasImage = (r) => Array.isArray(r?.images) && r.images.length > 0;
// K10：自动记录推来的 final 可能只是摘要（lite: true，不含图）——图未知，出过图（firstImageAt）的按有图计
const hasFinalImage = (r) => hasImage(r?.final) || (r?.finalAt != null && r?.final?.lite === true && r?.firstImageAt != null);

// 教师端本地切片：服务端定向发来的整面墙（不进班级记录）
export const WALL_INITIAL = Object.freeze({ wall: null, skipped: 0, openedAt: null });
export const WALL_HANDLERS = Object.freeze({
  'gallery:wall': (s, p) => ({
    wall: Array.isArray(p?.wall) ? p.wall : [],
    skipped: Number(p?.skipped) || 0,
    openedAt: p?.openedAt ?? Date.now(),
  }),
  'gallery:closed': () => WALL_INITIAL,
});

// 来源段里出过图的人数（最近运行或最终稿有图）
export const imageCount = (perStudent) => Object.values(perStudent ?? {}).filter((r) => hasImage(r) || hasFinalImage(r)).length;

// ---------- 教师端 ----------

function TeacherToolbar() {
  const c = useComponent(ID);
  const on = useGalleryStage(c.currentStage.id);
  if (c.role !== 'teacher' || !on) return null;
  const source = typeof c.options.source === 'string' ? c.options.source : DEFAULT_SOURCE;
  const n = imageCount(c.stageData(source).perStudent);
  return (
    <Btn variant="soft" size="sm" data-gallery-open="" onClick={() => c.send('gallery:t-open', {})}>
      {TEXT.button(n)}
    </Btn>
  );
}

function WallGrid({ wall, onPick }) {
  if (wall.length === 0) return <div style={{ color: 'var(--ink-dim)' }}>{TEXT.empty}</div>;
  return (
    <Tiles min="200px">
      {wall.map((w) => (
        <button key={w.name} type="button" data-gallery-card={w.name} onClick={() => onPick(w.name)} style={cardBtn}>
          <Card pad={12}>
            <Stack gap={2}>
              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{w.name}</span>
              <img alt={TEXT.spotlightOf(w.name)} src={src(w.image)} style={imgStyle} />
            </Stack>
          </Card>
        </button>
      ))}
    </Tiles>
  );
}

function TeacherOverlay() {
  const c = useComponent(ID);
  const local = c.slice ?? WALL_INITIAL;
  if (c.role !== 'teacher' || local.openedAt == null) return null;
  const wall = Array.isArray(local.wall) ? local.wall : [];
  const sp = c.data.perClass?.spotlight;
  const spot = sp?.name && typeof sp.image === 'string' ? sp : null;
  const close = () => {
    c.setLocal(WALL_INITIAL);
    c.send('gallery:t-close', {});
  };
  return (
    <Overlay variant="dialog" fill label={TEXT.title} testId="gallery-wall" onDismiss={close}>
      <Stack gap={3}>
        <Row gap={2}>
          <span style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', color: 'var(--ink)' }}>{spot ? TEXT.spotlightOf(spot.name) : TEXT.title}</span>
          {spot && <Btn variant="ghost" size="sm" data-gallery-back="" onClick={() => c.send('gallery:t-spotlight', {})}>{TEXT.back}</Btn>}
          <Btn variant="ghost" size="sm" data-gallery-close="" onClick={close}>{TEXT.close}</Btn>
        </Row>
        {spot ? (
          <img data-gallery-spotlight={spot.name} alt={TEXT.spotlightOf(spot.name)} src={src(spot.image)} style={imgStyle} />
        ) : (
          <WallGrid wall={wall} onPick={(name) => c.send('gallery:t-spotlight', { name })} />
        )}
        {local.skipped > 0 && <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>{TEXT.skipped(local.skipped)}</span>}
      </Stack>
    </Overlay>
  );
}

// ---------- 学生端 ----------

function StudentOverlay() {
  const c = useComponent(ID);
  const spot = c.data.perClass?.spotlight;
  if (c.role !== 'student' || !spot?.name || typeof spot.image !== 'string') return null;
  const caption = c.options.anonymous === true ? TEXT.spotlightAnon : TEXT.spotlightOf(spot.name);
  return (
    <Overlay variant="dialog" fill label={TEXT.title} testId="gallery-spotlight">
      <Stack gap={3}>
        <span data-gallery-caption="" style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', color: 'var(--ink)' }}>{caption}</span>
        <img alt={caption} src={src(spot.image)} style={imgStyle} />
      </Stack>
    </Overlay>
  );
}

function StudentAside({ stageId }) {
  const on = useGalleryStage(stageId);
  if (!on) return null;
  return <div data-gallery-aside="" style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>{TEXT.aside}</div>;
}

export default {
  slots: {
    teacherToolbar: TeacherToolbar,
    teacherOverlay: TeacherOverlay,
    studentOverlay: StudentOverlay,
    studentAside: StudentAside,
  },
  store: {
    student: { initial: {}, on: {} },
    teacher: { initial: WALL_INITIAL, on: WALL_HANDLERS },
  },
};
