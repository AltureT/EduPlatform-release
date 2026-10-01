// useCoachStage(stageId) → { on, intro, primitive, requirements, hasCode }：读该阶段 stage.config.js 顶层的 coach 字段（coach 组件规格 §2）
//   coach: true → { on: true, intro: null }；{ intro } → { on: true, intro }；false / 缺省 → { on: false, intro: null }
//   C6（AI 对照要求逐条核规格）：requirements = 本段要求清单原文（stage.options 的 requirements + tasks，verdicts.requirementsOf）；
//     hasCode = 学生端本人本段记录有代码（最终稿或最近运行，verdicts.codeOf）；教师端恒为 false
// 单独成模块（照 sandbox/client/stageConfig.js）：组件单测用 vi.mock 提供假阶段配置
import { useStudentStage } from '#kernel/client/index.js';
import { requirementsOf, codeOf } from './verdicts.js';

export function coachOf(stage) {
  const v = stage?.coach;
  const primitive = typeof stage?.primitive === 'string' ? stage.primitive : null;
  const requirements = requirementsOf(stage?.options);
  if (v === true) return { on: true, intro: null, primitive, requirements };
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return { on: true, intro: typeof v.intro === 'string' && v.intro.trim() ? v.intro : null, primitive, requirements };
  }
  return { on: false, intro: null, primitive, requirements };
}

export function useCoachStage(stageId) {
  const { stage, myData } = useStudentStage(stageId);
  return { ...coachOf(stage), hasCode: codeOf(myData) !== '' };
}
