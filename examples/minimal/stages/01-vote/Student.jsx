import { useStudentStage, Btn, Page, Tiles } from '#kernel/client/index.js';
import { QUESTION, OPTIONS } from './stage.config.js';

// 页面样式 focus（stage.config.js 的 layout）：题目进标题区，选项进 Main；点选项即提交（可改选），不需要单独的主按钮
export default function Student() {
  const { isLive, myData, classData, send } = useStudentStage('vote');
  const question = classData.question ?? QUESTION;
  const options = classData.options ?? OPTIONS;
  const current = myData?.choice ?? null;

  return (
    <Page template="focus" title={question}>
      <Page.Main>
        <Tiles min="140px" gap={3}>
          {options.map((o) => {
            const active = current === o.key;
            return (
              <Btn
                key={o.key}
                variant={active ? 'primary' : 'soft'}
                size="lg"
                aria-pressed={active}
                disabled={!isLive}
                onClick={() => send('student:vote', { choice: o.key })}
              >
                {o.key}. {o.text}
              </Btn>
            );
          })}
        </Tiles>
      </Page.Main>
    </Page>
  );
}
