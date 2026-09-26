// useSandboxConfig(stageId)：读该阶段 stage.config.sandbox（没有配置返回 null）；教师端与学生端通用（配置来自阶段注册表）
// 单独成模块：组件单测用 vi.mock 提供假阶段配置（直接 mock 内核公开入口会与内核的组件 glob 循环）
import { useStudentStage } from '#kernel/client/index.js';

export function useSandboxConfig(stageId) {
  const { stage } = useStudentStage(stageId);
  const sb = stage?.sandbox;
  return sb && typeof sb === 'object' && !Array.isArray(sb) ? sb : null;
}
