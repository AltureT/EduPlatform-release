// free-text 教师演示视图（大屏）：focus 模板，hint 为"提交 N/M（在线）"。
// 班级记录 featured 快照 { name, answers, at } 有值（教师在统计页点行 → "投到大屏"）时标题为"<姓名> 的作答"，
// 大字显示快照里的各题作答（带题目）——读快照不读该生最新记录，学生投屏后再"更新"不会改动大屏；
// 否则显示题目（单题进标题区，多题逐条列出），有 options.prompt（P4）时正文在题目列表之前；投屏时不显示正文（大屏留给作答）。
// 有 featured 时 Page.Actions 放"取消展示"（teacher:feature null）。
import { useTeacherStage, Btn, Page, Stack } from '#kernel/client/index.js';
import PromptText from '../_shared/PromptText.jsx';

const bigText = { fontSize: 'var(--fs-xl)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const smallTitle = { fontSize: 'var(--fs-md)', color: 'var(--ink-soft)' };

export default function TeacherDemo({ stageId } = {}) {
  const { stage, options, roster, perStudent, perClass, send } = useTeacherStage(stageId);

  if (!options) return <Page template="focus" />;

  const { prompts } = options;
  const connected = roster.filter((s) => s.connected);
  const done = connected.filter((s) => perStudent[s.name]?.submittedAt != null).length;
  const hint = `提交 ${done}/${connected.length}`;
  const snap = perClass?.featured && typeof perClass.featured.name === 'string' ? perClass.featured : null;
  const featured = snap ? snap.name : null;
  const single = prompts.length === 1;

  if (snap) {
    return (
      <Page template="focus" title={`${featured} 的作答`} hint={hint}>
        <Page.Main>
          <Stack gap={5} data-testid="freetext-featured">
            {prompts.map((p) => {
              const text = (snap.answers?.[p.id] ?? '').trim();
              return (
                <Stack gap={2} key={p.id}>
                  <div style={smallTitle}>{p.title}</div>
                  <div style={bigText}>{text || '（未作答）'}</div>
                </Stack>
              );
            })}
          </Stack>
        </Page.Main>
        <Page.Actions>
          <Btn variant="soft" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>
        </Page.Actions>
      </Page>
    );
  }

  return (
    <Page template="focus" title={single ? prompts[0].title : stage?.label} hint={hint}>
      <Page.Main>
        <Stack gap={5}>
          <PromptText text={options.prompt} size="lg" />
          {!single && (
            <ol style={{ ...bigText, margin: 0, paddingLeft: '1.5em', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              {prompts.map((p) => <li key={p.id}>{p.title}</li>)}
            </ol>
          )}
        </Stack>
      </Page.Main>
      {featured && (
        <Page.Actions>
          <Btn variant="soft" onClick={() => send('teacher:feature', { name: null })}>取消展示</Btn>
        </Page.Actions>
      )}
    </Page>
  );
}
