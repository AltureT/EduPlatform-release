// free-text 教师操作条按钮（T9a，教师视图与学生页重排规格 §2.2；原 TeacherDemo 的 Page.Actions）：
// 内核在演示 / 统计 / 明细三个视图的操作条左组、Page.Actions 之后渲染 <TeacherActions stageId />。
// 有投屏（班级记录 featured 快照）时"取消展示"（teacher:feature { name: null }）；其它情况不渲染。
import { useTeacherStage, Btn } from '#kernel/client/index.js';

export default function TeacherActions({ stageId } = {}) {
  const { options, perClass, send } = useTeacherStage(stageId);
  const featured = perClass?.featured && typeof perClass.featured.name === 'string' ? perClass.featured.name : null;
  if (!options || !featured) return null;
  return <Btn variant="soft" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>;
}
