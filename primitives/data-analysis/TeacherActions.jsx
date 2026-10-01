// data-analysis 教师操作条按钮（T9a，教师视图与学生页重排规格 §2.2；原 TeacherDemo 的 Page.Actions，"现场演示"已并入演示视图）：
// 内核在演示 / 统计 / 明细三个视图的操作条左组、Page.Actions 之后渲染 <TeacherActions stageId />。
// 有投屏（perClass.featured）时"取消展示"；"换一份展示"（teacher:feature-next，在出过图的学生里按首次出图先后轮换；没人出过图时不可点）；
// 有 solution 时"显示 / 隐藏参考答案"（teacher:show-solution）与"公布参考答案给学生"（两次点击）/"撤回参考答案"（teacher:publish-solution）。
import { useTeacherStage, Btn } from '#kernel/client/index.js';
import { everImage } from './primitive.config.js';
import { PublishSolutionBtn } from '../_shared/SolutionPanel.jsx';

export default function TeacherActions({ stageId } = {}) {
  const { options, perStudent, perClass, send } = useTeacherStage(stageId);
  if (!options) return null;
  const featured = perClass?.featured ?? null;
  const showSolution = !!options.solution && perClass?.showSolution === true;
  const publishedAt = options.solution ? perClass?.solutionPublishedAt ?? null : null;
  return (
    <>
      {featured && <Btn variant="ghost" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>}
      <Btn variant="accent" disabled={!Object.values(perStudent).some(everImage)} onClick={() => send('teacher:feature-next', {})}>换一份展示</Btn>
      {options.solution && (
        <Btn variant="soft" onClick={() => send('teacher:show-solution', { on: !showSolution })}>
          {showSolution ? '隐藏参考答案' : '显示参考答案'}
        </Btn>
      )}
      {options.solution && <PublishSolutionBtn publishedAt={publishedAt} send={send} />}
    </>
  );
}
