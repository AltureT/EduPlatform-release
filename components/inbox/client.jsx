// inbox 收件箱客户端（规格 §3.3）：教师工具栏按钮 + 抽屉；学生作答弹窗（无关闭按钮，只有教师能关）
// 覆盖层（界面整理规格 §2.3）：教师抽屉走内核 Overlay 的 drawer 形态，学生作答框走 dialog 形态（不传 onDismiss，点遮罩不关）
import { useState } from 'react';
import { useComponent, useTeacherStage, useNarrow, useDraft, Btn, Chip, Overlay, Row, Stack } from '#kernel/client/index.js';

const ID = 'inbox';

const answersOf = (perStudent, questionId) =>
  questionId == null
    ? []
    : Object.entries(perStudent ?? {})
        .filter(([, rec]) => rec && rec[questionId])
        .map(([name, rec]) => ({ name, ...rec[questionId] }));

const summary = (answers) =>
  Object.values(answers ?? {})
    .filter((v) => typeof v === 'string' && v.trim() !== '')
    .join(' / ');

// ---------------- 教师端 ----------------

function AnswerItem({ item, fields, expanded, onToggle }) {
  return (
    <li style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          minHeight: 'var(--control-h)',
          padding: '8px 0',
          background: 'none',
          border: 'none',
          color: 'var(--ink)',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span data-testid="inbox-name" style={{ fontWeight: 600, flex: 'none' }}>
          {item.name}
        </span>
        <span
          style={{
            color: 'var(--ink-soft)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {summary(item.answers)}
        </span>
      </button>
      {expanded && (
        <div data-testid="inbox-full" style={{ padding: '0 0 10px', display: 'grid', gap: 6 }}>
          {fields.map((f) => (
            <div key={f.key}>
              {f.label && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-dim)' }}>{f.label}</div>}
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.answers?.[f.key] ?? ''}</div>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function Drawer({ c, roster, items, onHide }) {
  const { open, question } = c.data.perClass ?? {};
  const questions = Array.isArray(c.options?.questions) ? c.options.questions : [];
  const [pick, setPick] = useState(questions[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [expanded, setExpanded] = useState(null);
  const online = (roster ?? []).filter((r) => r.connected).length;
  const fields = question?.fields ?? [];

  const start = () => {
    if (questions.length > 0) c.send('inbox:t-open', { questionId: pick });
    else c.send('inbox:t-open', { title: title.trim() });
  };
  const canStart = questions.length > 0 ? Boolean(pick) : title.trim() !== '';

  const inputStyle = {
    flex: 1,
    minWidth: 0,
    height: 'var(--control-h)',
    padding: '0 8px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    font: 'inherit',
  };

  return (
    <Overlay variant="drawer" label="收件箱" testId="inbox-drawer" onDismiss={onHide}>
      <div style={{ width: '100%', maxWidth: 960, marginLeft: 'auto', marginRight: 'auto', color: 'var(--ink)', textAlign: 'left' }}>
        <Stack gap={3}>
          <Row gap={2} wrap={false}>
            <strong style={{ flex: 1, fontSize: 'var(--fs-md)' }}>📥 收件箱</strong>
            <Btn variant="ghost" aria-label="收起" onClick={onHide}>
              ✕
            </Btn>
          </Row>

          {open ? (
            <Row gap={2} wrap={false}>
              <Chip tone="good">开启中</Chip>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{question?.title}</span>
              <Btn variant="accent" onClick={() => c.send('inbox:t-close', {})}>
                关闭
              </Btn>
            </Row>
          ) : (
            <Row gap={2} wrap={false}>
              {questions.length > 0 ? (
                <select value={pick} onChange={(e) => setPick(e.target.value)} style={inputStyle}>
                  {questions.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="标题"
                  style={inputStyle}
                />
              )}
              <Btn variant="primary" disabled={!canStart} onClick={start}>
                开启
              </Btn>
            </Row>
          )}

          {!open && question && <div style={{ color: 'var(--ink-soft)' }}>{question.title}</div>}

          <div style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>
            已收 {items.length} / 在线 {online}
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((item) => (
              <AnswerItem
                key={item.name}
                item={item}
                fields={fields}
                expanded={expanded === item.name}
                onToggle={() => setExpanded(expanded === item.name ? null : item.name)}
              />
            ))}
          </ul>
        </Stack>
      </div>
    </Overlay>
  );
}

function TeacherToolbar({ stageId }) {
  const c = useComponent(ID);
  const { roster } = useTeacherStage(stageId);
  // 顶栏芯片用 sm；narrow 时 toolbar 收进操作条"更多 ▾"菜单，用 md（界面整理规格 §4）
  const chipSize = useNarrow() ? 'md' : 'sm';
  if (!c.isEnabledFor(stageId)) return null;

  const question = c.data.perClass?.question ?? null;
  const items = answersOf(c.data.perStudent, question?.id).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const drawerOpen = Boolean(c.slice?.open);

  return (
    <>
      {/* aria-haspopup / aria-expanded：narrow 时本按钮在外壳"更多 ▾"菜单里，带这两个属性的按钮点击后菜单不关，
          抽屉（渲染在菜单子树里）才不会随菜单隐藏（契约 v0.7.1 更多菜单关闭行为） */}
      <Btn variant="soft" size={chipSize} aria-haspopup="dialog" aria-expanded={drawerOpen} onClick={() => c.setLocal({ open: !drawerOpen })}>
        📥 收件箱 {items.length}
      </Btn>
      {drawerOpen && <Drawer c={c} roster={roster} items={items} onHide={() => c.setLocal({ open: false })} />}
    </>
  );
}

// ---------------- 学生端 ----------------

function AnswerForm({ c, question, mine }) {
  const fields = question.fields ?? [];
  const fromAnswers = (answers) => Object.fromEntries(fields.map((f) => [f.key, typeof answers?.[f.key] === 'string' ? answers[f.key] : '']));
  // D1（学生输入自动保存规格 §2.4）：作答框自动保存；值 { q: 题目 id, answers }，题目换了就不用旧草稿；提交后清掉
  const [saved, setSaved, { clear: clearSaved }] = useDraft('answers', null, { stageId: 'component:inbox' });
  const hasSaved = saved && typeof saved === 'object' && saved.q === question.id && saved.answers && typeof saved.answers === 'object';
  // 已提交后点过"修改"、改了没交就刷新：回来仍在修改状态
  const [editing, setEditing] = useState(() => Boolean(mine) && Boolean(hasSaved));
  const draft = hasSaved ? fromAnswers(saved.answers) : fromAnswers(mine?.answers);
  const setDraft = (fn) => setSaved((prev) => {
    const base = prev && typeof prev === 'object' && prev.q === question.id && prev.answers ? fromAnswers(prev.answers) : fromAnswers(mine?.answers);
    return { q: question.id, answers: typeof fn === 'function' ? fn(base) : fn };
  });

  const showSubmitted = Boolean(mine) && !editing;
  const allEmpty = fields.every((f) => (draft[f.key] ?? '').trim() === '');
  const overMax = fields.some((f) => (draft[f.key] ?? '').length > f.max);

  const submit = () => {
    c.send('inbox:s-submit', { questionId: question.id, answers: { ...draft } });
    if (saved != null) clearSaved();
    setEditing(false);
  };
  const edit = () => {
    if (saved != null) clearSaved();
    setEditing(true);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{question.title}</div>
      {showSubmitted ? (
        <>
          {fields.map((f) => (
            <div key={f.key}>
              {f.label && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-dim)' }}>{f.label}</div>}
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{mine.answers?.[f.key] ?? ''}</div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <Chip tone="good">已提交</Chip>
            <span style={{ color: 'var(--ink-dim)' }}>·</span>
            <Btn variant="ghost" onClick={edit}>
              修改
            </Btn>
          </div>
        </>
      ) : (
        <>
          {fields.map((f) => {
            const value = draft[f.key] ?? '';
            return (
              <label key={f.key} style={{ display: 'grid', gap: 4 }}>
                {f.label && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-soft)' }}>{f.label}</span>}
                <textarea
                  value={value}
                  maxLength={f.max}
                  rows={4}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: 8,
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    font: 'inherit',
                    resize: 'vertical',
                  }}
                />
                <span
                  data-testid={`inbox-remain-${f.key}`}
                  style={{ justifySelf: 'end', fontSize: 'var(--fs-xs)', color: 'var(--ink-dim)' }}
                >
                  {f.max - value.length}
                </span>
              </label>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Btn variant="primary" disabled={allEmpty || overMax} onClick={submit}>
              提交
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}

function StudentOverlay() {
  const c = useComponent(ID);
  const { open, question } = c.data.perClass ?? {};
  if (!open || !question) return null;
  const mine = c.data.my?.[question.id];

  return (
    <Overlay variant="dialog" label={question.title} testId="inbox-answer">
      <div style={{ textAlign: 'left' }}>
        <AnswerForm key={question.id} c={c} question={question} mine={mine} />
      </div>
    </Overlay>
  );
}

export default {
  slots: {
    teacherToolbar: TeacherToolbar,
    studentOverlay: StudentOverlay,
  },
  store: {
    student: { initial: {}, on: {} },
    teacher: { initial: { open: false }, on: {} },
  },
};
