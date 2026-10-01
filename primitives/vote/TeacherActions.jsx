// vote 教师操作条按钮（T9a，教师视图与学生页重排规格 §2.2；原 TeacherDemo 的 Page.Actions）：
// 内核在演示 / 统计 / 明细三个视图的操作条左组、Page.Actions 之后渲染 <TeacherActions stageId />。
// 有 answer、当前段、子阶段 answer 时"揭晓"（teacher:reveal）；其它情况不渲染。
import { useTeacherStage, Btn } from '#kernel/client/index.js';

export default function TeacherActions({ stageId } = {}) {
  const { options, subPhase, isLive, send } = useTeacherStage(stageId);
  if (!options?.answer || !isLive || subPhase !== 'answer') return null;
  return <Btn variant="accent" onClick={() => send('teacher:reveal', {})}>揭晓</Btn>;
}
