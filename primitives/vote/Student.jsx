// vote 学生视图：focus 模板，题目进标题区，options.prompt（P4，可选正文）在标题下、选项之前；
// 选项按钮是整页的主操作（高 --control-h-lg、字号 --fs-lg）。
// 单选点一下即提交；多选可点多个，"提交"进操作条（Page.Actions）；canChange 时可改；
// 揭晓后显示对错与正确答案——正确答案只从班级记录 classData.answer 读（学生收到的 options 没有 answer，保密选项）；
// 非当前阶段置灰；镜像内保持原样显示但不响应。
// 多选未提交的勾选自动保存（useDraft 'choice'，学生输入自动保存规格 §2.4）；提交成功后清掉。
// T9a 教师演示模式（教师视图与学生页重排规格 §2.2；useStudentStage().demo）：可点选 / 提交，写本地演示记录
// （setMyData { choice, submittedAt }，不发事件）；不看是否当前段；揭晓（班级记录 answer）后同学生一样显示对错与正确答案。
import { useEffect, useRef } from 'react';
import { useStudentStage, useNarrow, useDraft, Btn, Chip, Page, Row, Stack, Tiles } from '#kernel/client/index.js';
import PromptText from '../_shared/PromptText.jsx';
import { formatChoice, orderKeys, toKeys } from './choices.js';

const btnStyle = {
  fontSize: 'var(--fs-lg)',
  height: 'auto',
  minHeight: 'var(--control-h-lg, calc(var(--control-h) * 1.5))',
  whiteSpace: 'normal',
  justifyContent: 'flex-start',
  textAlign: 'left',
  padding: 'var(--sp-2) var(--sp-4)',
};
const correctStyle = { background: 'var(--good)', borderColor: 'var(--good)', color: 'var(--surface)' };

// 列数：宽屏 ≤ 4 项排一行、5–8 项排两行；窄屏两列（3 项单列），不出现 3+1
export function columnsFor(n, narrow) {
  if (narrow) return n === 3 ? 1 : 2;
  return n <= 4 ? n : Math.ceil(n / 2);
}
const tileMin = (k) => `calc((100% - ${k - 1} * var(--sp-3)) / ${k})`;

export default function Student({ stageId } = {}) {
  const { stage, options, myData, classData, isLive, readOnly, send, demo, setMyData } = useStudentStage(stageId);
  const narrow = useNarrow();
  const [draftRaw, setDraft, { clear: clearDraft }] = useDraft('choice', null, { stageId: stageId ?? stage?.id });
  const draft = Array.isArray(draftRaw) ? draftRaw.filter((k) => typeof k === 'string') : null;
  const submittedAt = myData?.submittedAt ?? null;
  // 提交成功（submittedAt 变了）后清草稿；挂载时不清
  const seenAt = useRef(submittedAt);
  useEffect(() => {
    if (seenAt.current === submittedAt) return;
    seenAt.current = submittedAt;
    if (submittedAt != null) clearDraft();
  }, [submittedAt, clearDraft]);

  if (!options) return <Page template="focus" />;

  const { question, prompt, choices, multiple, canChange } = options;
  const answer = Array.isArray(classData?.answer) && classData.answer.length > 0 ? classData.answer : null;
  const mine = toKeys(myData?.choice);
  const submitted = mine.length > 0;
  const revealed = !!answer;
  // 回看（非当前阶段）按钮置灰；镜像内保持原样显示（外壳已加 inert，send 为 no-op），只是不响应
  const disabled = !isLive && !demo;
  const locked = disabled || readOnly || revealed || (canChange === false && submitted);
  const selected = multiple && draft ? draft : mine;
  const dirty = multiple && draft != null && orderKeys(options, draft).join() !== mine.join();

  // 演示模式：写本地记录，不发事件
  const vote = (choice) => {
    if (demo) setMyData({ choice, submittedAt: Date.now() });
    else send('student:vote', { choice });
  };
  const pick = (key) => {
    if (locked) return;
    if (!multiple) {
      vote(key);
      return;
    }
    setDraft(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };
  const submit = () => {
    if (locked || selected.length === 0) return;
    vote(orderKeys(options, selected));
  };

  const right = revealed && submitted && (myData?.correct ?? orderKeys(options, mine).join() === answer.join());
  let hint;
  if (submitted && !revealed) hint = '已提交';
  else if (multiple && !locked) hint = '可多选';

  return (
    <Page template="focus" title={question} hint={hint}>
      <Page.Main>
        <Stack gap={4}>
          <PromptText text={prompt} />
          {revealed && (
            <Row gap={3}>
              <Chip tone={submitted ? (right ? 'good' : 'bad') : 'neutral'}>{submitted ? (right ? '回答正确' : '回答错误') : '未作答'}</Chip>
              <span style={{ fontSize: 'var(--fs-lg)' }}>正确答案：{formatChoice(options, answer)}</span>
            </Row>
          )}
          <Tiles min={tileMin(columnsFor(choices.length, narrow))} gap={3} data-testid="vote-choices">
            {choices.map((c) => {
              const on = selected.includes(c.key);
              const isAnswer = revealed && answer.includes(c.key);
              const wrongPick = revealed && on && !isAnswer;
              let variant = on ? 'primary' : 'soft';
              if (wrongPick) variant = 'danger';
              return (
                <Btn
                  key={c.key}
                  variant={variant}
                  aria-pressed={on}
                  aria-disabled={locked || undefined}
                  data-correct={isAnswer ? 'true' : undefined}
                  disabled={disabled}
                  onClick={() => pick(c.key)}
                  style={{ ...btnStyle, ...(isAnswer ? correctStyle : null), cursor: locked ? 'default' : 'pointer' }}
                >
                  {c.key}. {c.text}
                </Btn>
              );
            })}
          </Tiles>
        </Stack>
      </Page.Main>
      {multiple && !locked && (
        <Page.Actions>
          <Btn variant="primary" disabled={selected.length === 0 || (submitted && !dirty)} onClick={submit}>
            {submitted ? '改为这个选择' : '提交'}
          </Btn>
        </Page.Actions>
      )}
    </Page>
  );
}
