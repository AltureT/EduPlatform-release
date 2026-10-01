// quiz 学生视图：focus 模板。作答：一题一页，标题"第 i / N 题"，hint 为倒计时（timeLimitSec）或已答数；
// 单选 / 判断是整页主操作的大按钮，填空是一行输入框；上一题 / 下一题 / 提交进操作条（Page.Actions）。
// options.prompt（P4，可选的全卷材料）在每一题的题面之前、结果页最上方显示。
// 题序：shuffle 时按学生名稳定打乱（order.js，与服务端同一算法）；提交一次即锁定。
// 作答与当前题号自动保存（useDraft 'answers' / 'pos'，学生输入自动保存规格 §2.4）：刷新、断线、关浏览器、换设备不丢；提交后清掉。
// 到时（enteredStageAt + timeLimitSec）自动提交已答部分（取自保存的作答，刷新后也不会交空卷）。
// 结果（提交后）按 showResultTo：
//   student-after-submit：本人记录里的 score / results / explanations → 得分、逐题对错与解析（不显示正确答案：学生端没有）；
//   reveal：揭晓前只显示"已提交，等待揭晓"与自己的作答；揭晓后正确答案与解析从班级记录 classData.answerKey / explanations 读；
//   never：只显示"已提交"与自己的作答。
// 回看 / 镜像：只显示结果（未提交显示"未提交"，已揭晓时"已揭晓，未提交"）；学生收到的 options 没有 answerKey / explanations（保密选项）。
import { useEffect, useRef, useState } from 'react';
import { useStudentStage, useNarrow, useDraft, Btn, Chip, Page, Row, Stack, Tiles } from '#kernel/client/index.js';
import PromptText from '../_shared/PromptText.jsx';
import { formatAnswer, formatKey, isAnswered, BLANK_MAX } from './items.js';
import { itemOrder } from './order.js';

const bigBtn = {
  fontSize: 'var(--fs-lg)',
  height: 'auto',
  minHeight: 'var(--control-h-lg, calc(var(--control-h) * 1.5))',
  whiteSpace: 'normal',
  justifyContent: 'flex-start',
  textAlign: 'left',
  padding: 'var(--sp-2) var(--sp-4)',
};
const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  height: 'var(--control-h-lg, calc(var(--control-h) * 1.5))',
  padding: '0 var(--sp-3)',
  fontSize: 'var(--fs-lg)',
  fontFamily: 'inherit',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface)',
  color: 'var(--ink)',
};
const questionStyle = { fontSize: 'var(--fs-lg)', lineHeight: 1.6, whiteSpace: 'pre-wrap' };
const itemBox = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--sp-4)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
};
const dim = { color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' };

export function columnsFor(n, narrow) {
  if (narrow) return n === 3 ? 1 : 2;
  return n <= 4 ? n : Math.ceil(n / 2);
}
const tileMin = (k) => `calc((100% - ${k - 1} * var(--sp-3)) / ${k})`;

export const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// 每秒刷新的当前时间（有倒计时时才启用）
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function Choices({ item, value, onPick, disabled, narrow }) {
  const list = item.type === 'single'
    ? item.choices.map((c) => ({ v: c.key, label: `${c.key}. ${c.text}` }))
    : [{ v: true, label: '对' }, { v: false, label: '错' }];
  const cols = item.type === 'single' ? columnsFor(list.length, narrow) : 2;
  return (
    <Tiles min={tileMin(cols)} gap={3} data-testid="quiz-choices">
      {list.map((c) => {
        const on = value === c.v;
        return (
          <Btn
            key={String(c.v)}
            variant={on ? 'primary' : 'soft'}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onPick(c.v)}
            style={{ ...bigBtn, ...(item.type === 'truefalse' ? { justifyContent: 'center', textAlign: 'center' } : null) }}
          >
            {c.label}
          </Btn>
        );
      })}
    </Tiles>
  );
}

function ResultList({ items, answers, results, answerKey, explanations }) {
  return (
    <Stack gap={3} data-testid="quiz-results">
      {items.map((it, i) => {
        const ok = results ? results[it.id] === true : null;
        const explain = explanations?.[it.id];
        return (
          <div key={it.id} style={itemBox} data-testid="quiz-result-item">
            <Row gap={2}>
              <span style={{ fontWeight: 600 }}>第 {i + 1} 题</span>
              {ok != null && <Chip tone={ok ? 'good' : 'bad'}>{ok ? '正确' : '错误'}</Chip>}
            </Row>
            <div style={{ whiteSpace: 'pre-wrap' }}>{it.question}</div>
            <div style={dim}>你的答案：{formatAnswer(it, answers?.[it.id])}</div>
            {answerKey && answerKey[it.id] !== undefined && <div style={dim}>正确答案：{formatKey(it, answerKey[it.id])}</div>}
            {explain && <div style={dim}>解析：{explain}</div>}
          </div>
        );
      })}
    </Stack>
  );
}

export default function Student({ stageId } = {}) {
  const { stage, options, me, myData, classData, isLive, readOnly, send } = useStudentStage(stageId);
  const narrow = useNarrow();
  const sid = stageId ?? stage?.id;
  const [draftRaw, setDraft, answersDraft] = useDraft('answers', {}, { stageId: sid });
  const [posRaw, setPos, posDraft] = useDraft('pos', 0, { stageId: sid });
  const draft = draftRaw && typeof draftRaw === 'object' && !Array.isArray(draftRaw) ? draftRaw : {};
  const pos = Number.isInteger(posRaw) && posRaw >= 0 ? posRaw : 0;
  const sentRef = useRef(false);

  const submitted = myData?.submittedAt != null;
  // 提交成功（本人记录有 submittedAt）后清掉草稿；没有草稿时不发
  const clearAnswers = answersDraft.clear;
  const clearPos = posDraft.clear;
  const hasDraft = answersDraft.restored != null || posDraft.restored != null || Object.keys(draft).length > 0 || pos !== 0;
  useEffect(() => {
    if (submitted && hasDraft && !readOnly) {
      clearAnswers();
      clearPos();
    }
  }, [submitted, hasDraft, readOnly, clearAnswers, clearPos]);
  // 揭晓后（班级记录有 revealedAt）服务端拒绝提交，未提交的学生不再停在作答页
  const revealedClass = classData?.revealedAt != null;
  const canAnswer = !!options && isLive && !readOnly && !submitted && !revealedClass;
  const limitMs = options?.timeLimitSec ? options.timeLimitSec * 1000 : null;
  const deadline = limitMs && typeof me?.enteredStageAt === 'number' ? me.enteredStageAt + limitMs : null;
  const now = useNow(canAnswer && deadline != null);
  const remaining = deadline != null ? Math.max(0, deadline - now) : null;

  const submit = () => {
    if (!canAnswer) return;
    const answers = {};
    for (const [k, v] of Object.entries(draft)) if (isAnswered(typeof v === 'string' ? v.trim() : v)) answers[k] = v;
    send('student:quiz-submit', { answers });
  };

  // 到时自动提交已答部分（只自动发一次；被拒后学生仍可手动按"提交"）
  useEffect(() => {
    if (canAnswer && remaining === 0 && !sentRef.current) {
      sentRef.current = true;
      submit();
    }
  });

  if (!options) return <Page template="focus" />;

  const title = stage?.label ?? '小测验';
  const byId = new Map(options.items.map((it) => [it.id, it]));

  if (submitted || !canAnswer) {
    if (!submitted) {
      return (
        <Page template="focus" title={title}>
          <Page.Main>
            <Row gap={2}><Chip tone="neutral">{revealedClass ? '已揭晓，未提交' : '未提交'}</Chip></Row>
          </Page.Main>
        </Page>
      );
    }
    const mode = options.showResultTo;
    const answerKey = mode === 'reveal' && classData?.answerKey ? classData.answerKey : null;
    const results = mode !== 'never' && myData.results ? myData.results : null;
    const explanations = results ? (myData.explanations ?? classData?.explanations ?? null) : null;
    let head;
    if (results) head = <Chip tone="brand">得分 {myData.score} / {myData.total}</Chip>;
    else if (mode === 'reveal') head = <Chip tone="neutral">已提交，等待揭晓</Chip>;
    else head = <Chip tone="good">已提交</Chip>;
    return (
      <Page template="focus" title={title}>
        <Page.Main>
          <Stack gap={4}>
            <PromptText text={options.prompt} />
            <Row gap={2}>{head}</Row>
            <ResultList items={options.items} answers={myData.answers} results={results} answerKey={answerKey} explanations={explanations} />
          </Stack>
        </Page.Main>
      </Page>
    );
  }

  const order = itemOrder(options, me?.name).map((id) => byId.get(id)).filter(Boolean);
  const n = order.length;
  const i = Math.min(pos, n - 1);
  const item = order[i];
  const value = draft[item.id];
  const set = (v) => setDraft((d) => ({ ...d, [item.id]: v }));
  const answeredCount = order.filter((it) => isAnswered(typeof draft[it.id] === 'string' ? draft[it.id].trim() : draft[it.id])).length;
  const last = i === n - 1;
  let hint = remaining != null ? `剩余 ${fmtClock(remaining)}` : `已答 ${answeredCount} / ${n}`;
  if (last && answeredCount < n) hint += ` · 还有 ${n - answeredCount} 题未答`;

  return (
    <Page template="focus" title={`第 ${i + 1} / ${n} 题`} hint={hint}>
      <Page.Main>
        <Stack gap={4}>
          <PromptText text={options.prompt} />
          <div style={questionStyle}>{item.question}</div>
          {item.type === 'blank'
            ? (
              <input
                type="text"
                aria-label="填空作答"
                value={value ?? ''}
                maxLength={BLANK_MAX}
                onChange={(e) => set(e.target.value)}
                style={inputStyle}
              />
            )
            : <Choices item={item} value={value} onPick={(v) => set(value === v ? undefined : v)} narrow={narrow} />}
        </Stack>
      </Page.Main>
      <Page.Actions>
        <Btn variant="soft" disabled={i === 0} onClick={() => setPos(i - 1)}>上一题</Btn>
        {last
          ? <Btn variant="primary" onClick={submit}>提交</Btn>
          : <Btn variant="primary" onClick={() => setPos(i + 1)}>下一题</Btn>}
      </Page.Actions>
    </Page>
  );
}
