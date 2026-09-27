// useGalleryStage(stageId) → boolean：该段 stage.config.js 顶层 gallery 是否为真（与 coach: true 同一约定）
// 单独成模块（照 components/coach/stageConfig.js）：组件单测用 vi.mock 提供假阶段配置
import { useStudentStage } from '#kernel/client/index.js';

export const galleryOf = (stage) => stage?.gallery === true;

export function useGalleryStage(stageId) {
  const { stage } = useStudentStage(stageId);
  return galleryOf(stage);
}
