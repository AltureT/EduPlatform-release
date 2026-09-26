// free-text 学生视图：focus 模板。单题时题目进标题区、文本框撑满面板；多题时标题为阶段名，各题标题 + 文本框纵向排列。
// options.prompt（P4，可选的共用材料）在标题下、文本框之前。
// 每题下方字数计数"已写 n / max"（有 min 时加"至少 min 字"，超上限或不到下限标红，提交不可点）；
// 主按钮进操作条：未提交"提交"，已提交且 canChange"更新"（未改动不可点）；canChange=false 提交后只读。
// 回看 / 镜像：只读显示已提交的原文。
import { useEffect, useState } from 'react';
import { useStudentStage, Btn, Fill, Page, Stack } from '#kernel/client/index.js';
import PromptText from '../_shared/PromptText.jsx';
import { countChars } from './prompts.js';

const boxStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 'var(--sp-3)',
  fontSize: 'var(--fs-md)',
  lineHeight: 1.6,
  fontFamily: 'inherit',
  resize: 'vertical',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface)',
  color: 'var(--ink)',
};
const titleStyle = { fontSize: 'var(--fs-lg)', fontWeight: 600 };

function Counter({ prompt, text }) {
  const n = countChars(text);
  const bad = n > prompt.max || (n > 0 && n < prompt.min);
  return (
    <div
      data-testid={`count-${prompt.id}`}
      style={{ fontSize: 'var(--fs-sm)', color: bad ? 'var(--bad)' : 'var(--ink-soft)', textAlign: 'right' }}
    >
      已写 {n} / {prompt.max}{prompt.min > 0 ? ` · 至少 ${prompt.min} 字` : ''}
    </div>
  );
}

export default function Student({ stageId } = {}) {
  const { stage, options, myData, isLive, readOnly, send } = useStudentStage(stageId);
  const [draft, setDraft] = useState(null);
  const submittedAt = myData?.submittedAt ?? null;
  useEffect(() => setDraft(null), [submittedAt]);

  if (!options) return <Page template="focus" />;

  const { prompts, canChange } = options;
  const saved = myData?.answers ?? {};
  const submitted = submittedAt != null;
  const values = Object.fromEntries(prompts.map((p) => [p.id, draft?.[p.id] ?? saved[p.id] ?? '']));
  const locked = !isLive || readOnly || (canChange === false && submitted);
  const valid = prompts.some((p) => countChars(values[p.id]) > 0)
    && prompts.every((p) => { const n = countChars(values[p.id]); return n <= p.max && n >= p.min; });
  const dirty = prompts.some((p) => values[p.id].trim() !== (saved[p.id] ?? '').trim());
  const single = prompts.length === 1;

  const edit = (id, v) => setDraft((d) => ({ ...(d ?? {}), [id]: v }));
  const submit = () => {
    if (locked || !valid) return;
    send('student:freetext-submit', { answers: Object.fromEntries(prompts.map((p) => [p.id, values[p.id]])) });
  };

  const box = (p, rows) => (
    <textarea
      aria-label={p.title}
      value={values[p.id]}
      placeholder={p.placeholder}
      readOnly={locked}
      rows={rows}
      onChange={(e) => edit(p.id, e.target.value)}
      style={{ ...boxStyle, ...(rows == null ? { flex: '1 1 auto', resize: 'none' } : null) }}
    />
  );

  return (
    <Page template="focus" title={single ? prompts[0].title : stage?.label} hint={submitted ? '已提交' : undefined}>
      <Page.Main>
        {single
          ? (
            <Fill>
              <PromptText text={options.prompt} />
              {box(prompts[0], null)}
              <Counter prompt={prompts[0]} text={values[prompts[0].id]} />
            </Fill>
          )
          : (
            <Stack gap={5}>
              <PromptText text={options.prompt} />
              {prompts.map((p) => (
                <Stack gap={2} key={p.id}>
                  <div style={titleStyle}>{p.title}</div>
                  {box(p, 4)}
                  <Counter prompt={p} text={values[p.id]} />
                </Stack>
              ))}
            </Stack>
          )}
      </Page.Main>
      {!locked && (
        <Page.Actions>
          <Btn variant="primary" disabled={!valid || (submitted && !dirty)} onClick={submit}>
            {submitted ? '更新' : '提交'}
          </Btn>
        </Page.Actions>
      )}
    </Page>
  );
}
