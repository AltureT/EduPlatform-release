import { useTeacherStage, BarDistribution, Page } from '#kernel/client/index.js';
import { QUESTION, OPTIONS } from './stage.config.js';

// 演示视图：focus 模板，题目进标题区、提交人数进 hint；推进按钮由外壳操作条提供（契约 v0.7）
export default function TeacherDemo() {
  const { roster, perStudent, perClass } = useTeacherStage('vote');
  const question = perClass.question ?? QUESTION;
  const options = perClass.options ?? OPTIONS;

  const counts = Object.fromEntries(options.map((o) => [o.key, 0]));
  for (const rec of Object.values(perStudent)) {
    if (rec?.choice in counts) counts[rec.choice] += 1;
  }
  const items = options.map((o) => ({ label: `${o.key}. ${o.text}`, value: counts[o.key] }));

  const connected = roster.filter((s) => s.connected);
  const submitted = connected.filter((s) => perStudent[s.name]?.choice != null).length;

  return (
    <Page template="focus" title={question} hint={`提交 ${submitted}/${connected.length}`}>
      <Page.Main>
        <BarDistribution items={items} />
      </Page.Main>
    </Page>
  );
}
