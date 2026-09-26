// classroom:state（= getPublicState()，规格 §5 + v0.4.1）→ 两个核心 store 共用的字段映射
// 载荷：{ lessonId, title, glyph, theme, curtain:{label,override}, rosterDefault:'roster'|'free',
//        stage, stageIndex, subPhase, stages:[…], students:[…], counts:{online,total},
//        rosterMode, rosterNames, claimedNames, classEpoch, components:[{ id, label, options, stages }]（v0.5） }
// store 侧：roster ← students；lesson = { id, title, glyph, theme, curtain, rosterDefault }

export const EMPTY_LESSON = Object.freeze({
  id: null,
  title: '',
  glyph: '',
  theme: {},
  curtain: { label: '', override: null },
  rosterDefault: 'roster',
});

export const EMPTY_COUNTS = Object.freeze({ online: 0, total: 0 });

function lessonFrom(data, prev) {
  const base = prev || EMPTY_LESSON;
  const out = { ...base };
  let touched = false;
  if ('lessonId' in data) { out.id = data.lessonId ?? null; touched = true; }
  if ('title' in data) { out.title = data.title ?? ''; touched = true; }
  if ('glyph' in data) { out.glyph = data.glyph ?? ''; touched = true; }
  if ('theme' in data) { out.theme = data.theme && typeof data.theme === 'object' ? data.theme : {}; touched = true; }
  if ('curtain' in data) {
    const c = data.curtain && typeof data.curtain === 'object' ? data.curtain : {};
    out.curtain = { label: c.label ?? '', override: c.override ?? null };
    touched = true;
  }
  if ('rosterDefault' in data) { out.rosterDefault = data.rosterDefault === 'free' ? 'free' : 'roster'; touched = true; }
  return touched ? out : null;
}

// 返回要写入 store 的部分字段；viewedStageIndex 随 stageIndex 追上 live
export function mapPublicState(data, prev = {}) {
  if (!data || typeof data !== 'object') return {};
  const out = {};
  const lesson = lessonFrom(data, prev.lesson);
  if (lesson) out.lesson = lesson;
  if ('stage' in data) out.stage = data.stage;
  if ('stageIndex' in data) {
    out.stageIndex = data.stageIndex;
    out.viewedStageIndex = data.stageIndex;
  }
  if ('subPhase' in data) out.subPhase = data.subPhase ?? null;
  if (Array.isArray(data.stages)) out.stages = data.stages;
  if (Array.isArray(data.components)) out.components = data.components;
  if (Array.isArray(data.students)) out.roster = data.students;
  if (data.counts && typeof data.counts === 'object') out.counts = data.counts;
  if ('rosterMode' in data) out.rosterMode = !!data.rosterMode;
  if ('rosterNames' in data) out.rosterNames = Array.isArray(data.rosterNames) ? data.rosterNames : [];
  if ('claimedNames' in data) out.claimedNames = Array.isArray(data.claimedNames) ? data.claimedNames : [];
  if (data.classEpoch) out.classEpoch = data.classEpoch;
  return out;
}
