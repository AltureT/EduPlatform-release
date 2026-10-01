// free-text 统计视图摘要区（T9a，教师视图与学生页重排规格 §2.3：原教师演示视图的主体搬来，TeacherStats 经 StatsPage 的 summaryBlock 放在
// 摘要芯片与提醒条之下；提交 N/M 在摘要芯片里）。
// 班级记录 featured 快照 { name, answers, at } 有值（教师在明细表点行 → "投到大屏"）时一行"<姓名> 的作答"，
// 大字显示快照里的各题作答（带题目）——读快照不读该生最新记录，学生投屏后再"更新"不会改动大屏；
// 否则显示题目（逐条列出），有 options.prompt（P4）时正文在题目列表之前；投屏时不显示正文（大屏留给作答）。
// "取消展示"按钮在 TeacherActions.jsx（操作条）。
import { useTeacherStage, Stack } from '#kernel/client/index.js';
import PromptText from '../_shared/PromptText.jsx';

const bigText = { fontSize: 'var(--fs-xl)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const smallTitle = { fontSize: 'var(--fs-md)', color: 'var(--ink-soft)' };
const headTitle = { fontSize: 'var(--fs-lg)', fontWeight: 600 };

export default function Summary({ stageId } = {}) {
  const { options, perClass } = useTeacherStage(stageId);

  if (!options) return null;

  const { prompts } = options;
  const snap = perClass?.featured && typeof perClass.featured.name === 'string' ? perClass.featured : null;
  const featured = snap ? snap.name : null;

  if (snap) {
    return (
      <Stack gap={5} data-testid="freetext-featured">
        <div style={headTitle}>{featured} 的作答</div>
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
    );
  }

  return (
    <Stack gap={5} data-testid="freetext-summary">
      <PromptText text={options.prompt} size="lg" />
      <ol style={{ ...bigText, margin: 0, paddingLeft: '1.5em', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {prompts.map((p) => <li key={p.id}>{p.title}</li>)}
      </ol>
    </Stack>
  );
}
