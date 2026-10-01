// code 教师操作条按钮（T9a，教师视图与学生页重排规格 §2.2；原 TeacherDemo 的 Page.Actions，"现场演示"已并入演示视图）：
// 内核在演示 / 统计 / 明细三个视图的操作条左组、Page.Actions 之后渲染 <TeacherActions stageId />。
// 有投屏（perClass.featured）时"取消展示"（teacher:feature { name: null }）；有 solution 时"显示 / 隐藏参考答案"
// （teacher:show-solution，统计视图摘要区显示参考答案；参考答案来自教师端完整 options）与"公布参考答案给学生"
// （两次点击，teacher:publish-solution { on: true }）/ 已公布时"撤回参考答案"（{ on: false }）。都没有时不渲染。
import { useTeacherStage, Btn } from '#kernel/client/index.js';
import { PublishSolutionBtn } from '../_shared/SolutionPanel.jsx';

export default function TeacherActions({ stageId } = {}) {
  const { options, perClass, send } = useTeacherStage(stageId);
  if (!options) return null;
  const featured = perClass?.featured ?? null;
  const showSolution = !!options.solution && perClass?.showSolution === true;
  const publishedAt = options.solution ? perClass?.solutionPublishedAt ?? null : null;
  if (!featured && !options.solution) return null;
  return (
    <>
      {featured && <Btn variant="ghost" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>}
      {options.solution && (
        <Btn variant="soft" onClick={() => send('teacher:show-solution', { on: !showSolution })}>
          {showSolution ? '隐藏参考答案' : '显示参考答案'}
        </Btn>
      )}
      {options.solution && <PublishSolutionBtn publishedAt={publishedAt} send={send} />}
    </>
  );
}
