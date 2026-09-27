// useCoachStage(stageId) → { on, intro, primitive }：读该阶段 stage.config.js 顶层的 coach 字段（coach 组件规格 §2）
//   coach: true → { on: true, intro: null }；{ intro } → { on: true, intro }；false / 缺省 → { on: false, intro: null }
// 单独成模块（照 sandbox/client/stageConfig.js）：组件单测用 vi.mock 提供假阶段配置
import { useStudentStage } from '#kernel/client/index.js';

export function coachOf(stage) {
  const v = stage?.coach;
  const primitive = typeof stage?.primitive === 'string' ? stage.primitive : null;
  if (v === true) return { on: true, intro: null, primitive };
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return { on: true, intro: typeof v.intro === 'string' && v.intro.trim() ? v.intro : null, primitive };
  }
  return { on: false, intro: null, primitive };
}

export function useCoachStage(stageId) {
  const { stage } = useStudentStage(stageId);
  return coachOf(stage);
}
