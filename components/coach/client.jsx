// coach 组件客户端（coach 组件规格 §3、§6、§12）
// 学生端：studentBanner 一行"卡住了？… [问一下]"（本段 coach 为真、组件已配置、没在回看、老师没暂停时）；studentOverlay 是点"问一下"后的 drawer
//   （说明、四个求助类型 Chip 单选、输入框 ≤ 500 字、发送、本段历史问答、还能问 N 次）。回答经组件数据到达（data.my.asks 最后一项），不另发事件。
//   §12.1：缺省 think；本段没有 ok 回答时不显示 follow；follow 要写 ≥ 4 字才能发。§12.6：暂停时抽屉一行"老师暂停了 AI 助手"并禁用发送。
//   draft：sandbox 编辑器草稿（localStorage，键由 draftKey 得到）；sandbox 没开或读不到就不带。
// 教师端：teacherToolbar 已配置时是按钮"AI 助手 · 已答 N"，点一下发 coach:t-pause 暂停 / 恢复（未配置仍是芯片"AI 助手未配置"）；
//   teacherSidebar（统计视图 Side，本段 coach 为真时）"求助"名单：每条问答前缀求助类型与 L1–L3，被拒的灰字标原因，"索答 N 次"标记。
// U6（代码展示统一高亮规格 §4）：抽屉与教师侧栏里的回答按行分段——连续的"像代码的行"（codeLine.js 的 CODE_LINE，与服务端 sanitize 同一个正则）
//   并成一个 <CodeView size="sm" wrap>，其余文字仍 pre-wrap；没有代码行时照旧一个 <span>。学生的提问 q 不处理。
import { useEffect, useState } from 'react';
import { useComponent, useTeacherStage, Btn, Chip, CodeView, HelpTip, Overlay, Row, Stack } from '#kernel/client/index.js';
import { draftKey, readDraft } from '#components/sandbox/client/ui/draftStorage.js';
import { useCoachStage } from './stageConfig.js';
import { codeSegments } from './codeLine.js';

const ID = 'coach';
export const DEFAULTS = Object.freeze({ maxPerStage: 5, cooldownMs: 20000, refusedCooldownMs: 60000 });
export const QUESTION_MAX = 500;
export const DRAFT_MAX = 20000;
// 发出后等回答的上限（排队 + 服务端 25 s 超时，最长约 75 s）；拒绝（冷却 / 在途 / 排队满）不写数据，靠它解除"AI 在想…"
export const PENDING_MS = 90000;
export const FLAG_ASKS = 3;
// 与服务端一致（server.js REFUSED_STREAK、FOLLOW_MIN；guard.js REPLY）
export const REFUSED_STREAK = 3;
export const FOLLOW_MIN = 4;
export const REFUSED_REPLY = Object.freeze({
  answer: '我不能直接给答案。说说你现在做到哪一步、卡在哪里，我给你下一条提示。',
  inject: '这个我帮不了。问跟这道题有关的吧。',
});

// §12.1 求助类型：抽屉按钮文案 / 教师侧栏前缀
export const KINDS = Object.freeze(['understand', 'think', 'debug', 'follow']);
export const DEFAULT_KIND = 'think';
export const KIND_LABEL = Object.freeze({ understand: '看不懂题', think: '不知道怎么下手', debug: '报错 / 结果不对', follow: '追问上一条' });
export const KIND_PREFIX = Object.freeze({ understand: '看不懂题', think: '怎么下手', debug: '报错', follow: '追问' });

export const TEXT = Object.freeze({
  intro: '卡住了？可以问 AI 要个提示（只给提示，不给答案）',
  ask: '问一下',
  hint: '说说你卡在哪（不说也行）',
  followHint: '上一条回答哪里没懂？至少写 4 个字',
  send: '发送',
  thinking: 'AI 在想…',
  failed: 'AI 现在没回应，先自己再试一次，或者举手',
  limited: '这一段的提问次数用完了，举手问老师',
  cooldown: (n) => `刚问过，等 ${n} 秒再问`,
  refusedCooldown: (n) => `刚被拒过几次，等 ${n} 秒再问`,
  paused: '老师暂停了 AI 助手',
  remaining: (n) => `还能问 ${n} 次`,
  label: 'AI 助手',
  notConfigured: 'AI 助手未配置',
  notConfiguredHelp: '到管理台"设置"页填 AI 接口',
  answered: (n) => `AI 助手 · 已答 ${n}`,
  pausedBtn: 'AI 助手已暂停 · 点此恢复',
  toolbarHelp: '开了 AI 助手的段，学生点"问一下"向 AI 要提示（只给提示，不给答案）；统计页右侧"求助"看每人问了什么。随堂测验时可暂停：点一下暂停，再点恢复',
  flag: '多次求助未通过',
  refusedFlag: (n) => `索答 ${n} 次`,
  refusedTag: { answer: '（已拒绝：索要答案）', inject: '（已拒绝：无关请求）' },
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonNegInt = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);

// ---------- 纯函数 ----------

export function limitsOf(options) {
  return {
    maxPerStage: nonNegInt(options?.maxPerStage, DEFAULTS.maxPerStage),
    cooldownMs: nonNegInt(options?.cooldownMs, DEFAULTS.cooldownMs),
    refusedCooldownMs: nonNegInt(options?.refusedCooldownMs, DEFAULTS.refusedCooldownMs),
  };
}

const asksOf = (rec) => (Array.isArray(rec?.asks) ? rec.asks.filter(isPlainObject) : []);
export const stageAsks = (rec, stageId) => asksOf(rec).filter((a) => a.stageId === stageId);
export const usedIn = (rec, stageId) => {
  const n = rec?.byStage?.[stageId];
  return Number.isInteger(n) ? n : stageAsks(rec, stageId).length;
};

// 距上次（非 limited）提问的冷却剩余秒数；0 = 可以问
export function cooldownLeft(rec, cooldownMs, now = Date.now()) {
  if (!(cooldownMs > 0)) return 0;
  const last = [...asksOf(rec)].reverse().find((a) => a.status !== 'limited');
  if (!last || typeof last.at !== 'number') return 0;
  const left = last.at + cooldownMs - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// §12.3 渐进冷却剩余秒数：本段 refused ≥ 3 → 距最近一次被拒 cooldownMs + refusedCooldownMs；0 = 不在冷却
export function refusedLeft(rec, stageId, limits, now = Date.now()) {
  if (!(limits.refusedCooldownMs > 0)) return 0;
  const refused = stageAsks(rec, stageId).filter((a) => a.status === 'refused');
  if (refused.length < REFUSED_STREAK) return 0;
  const at = refused[refused.length - 1].at;
  if (typeof at !== 'number') return 0;
  const left = at + limits.cooldownMs + limits.refusedCooldownMs - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// 学生本段的状态提示（一句人话）；null = 没有
export function studentNotice({ rec, stageId, limits, now = Date.now(), paused = false }) {
  if (paused) return { tone: 'warn', text: TEXT.paused };
  const asks = stageAsks(rec, stageId);
  const last = asks[asks.length - 1];
  if (last?.status === 'limited' || usedIn(rec, stageId) >= limits.maxPerStage) return { tone: 'warn', text: TEXT.limited };
  const refusedWait = refusedLeft(rec, stageId, limits, now);
  if (refusedWait > 0) return { tone: 'warn', text: TEXT.refusedCooldown(refusedWait) };
  const wait = cooldownLeft(rec, limits.cooldownMs, now);
  if (last?.status === 'failed') return { tone: 'bad', text: TEXT.failed };
  if (wait > 0) return { tone: 'neutral', text: TEXT.cooldown(wait) };
  return null;
}

export function readDraftCode({ lessonId, classEpoch, name, stageId }) {
  const d = readDraft(draftKey({ lessonId, classEpoch, name, stageId }));
  const code = typeof d?.code === 'string' ? d.code : '';
  if (!code.trim()) return undefined;
  return code.length > DRAFT_MAX ? code.slice(0, DRAFT_MAX) : code;
}

export const answeredCount = (perStudent) => Object.values(perStudent ?? {})
  .reduce((n, rec) => n + asksOf(rec).filter((a) => a.status === 'ok').length, 0);

const allPassed = (t) => isPlainObject(t) && Number(t.total) > 0 && Number(t.failed) + Number(t.errors) === 0;

// "未通过"（规格 §6）：code 段 = 无记录或 tests 存在且未全过；data-analysis 段 = 没有 firstImageAt；其它段 = 无记录。
// 记录里有 tests 字段时不论 primitive 都按 code 段规则（自写 sandbox 段如示例课 03-tests 也能标出）
export function notPassed(primitive, record) {
  if (primitive === 'code') return !record || (record.tests != null && !allPassed(record.tests));
  if (record?.tests != null) return !allPassed(record.tests);
  if (primitive === 'data-analysis') return record?.firstImageAt == null;
  return !record;
}

// 求助名单：本段问过的学生，按本段次数倒序（同数按最近一次在前）
// status：本段次数已到 maxPerStage → 'limited'（学生端次数用完时禁用发送，服务端走不到记 limited 那一步）；否则最后一条的状态
export function helpRows({ perStudent, stageId, records, primitive, roster, maxPerStage = DEFAULTS.maxPerStage }) {
  const connected = new Map((roster ?? []).map((r) => [r.name, r.connected !== false]));
  return Object.entries(perStudent ?? {})
    .map(([name, rec]) => {
      const asks = stageAsks(rec, stageId);
      const count = usedIn(rec, stageId);
      const last = asks[asks.length - 1];
      return {
        name,
        count,
        asks,
        refused: asks.filter((a) => a.status === 'refused').length,
        status: count >= maxPerStage ? 'limited' : last?.status ?? null,
        lastAt: last?.at ?? 0,
        connected: connected.get(name) ?? true,
        flagged: count >= FLAG_ASKS && notPassed(primitive, records?.[name]),
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

const STATUS_CHIP = {
  ok: { tone: 'good', text: '已答' },
  failed: { tone: 'neutral', text: '失败' },
  limited: { tone: 'warn', text: '已限制' },
  refused: { tone: 'warn', text: '已拒绝' },
};

// 被拒条目的原因：a 是哪一句固定回复
export const refusedTagOf = (a) => (a?.a === REFUSED_REPLY.inject ? TEXT.refusedTag.inject : TEXT.refusedTag.answer);
// "怎么下手 · L2"；旧数据没有 kind / level 就不写
export function askMeta(a) {
  const parts = [];
  if (KIND_PREFIX[a?.kind]) parts.push(KIND_PREFIX[a.kind]);
  if (Number.isInteger(a?.level)) parts.push(`L${a.level}`);
  return parts.join(' · ');
}

// ---------- 学生端 ----------

const bannerRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  maxHeight: 'var(--control-h)',
  padding: '0 var(--sp-4)',
  background: 'var(--brand-soft)',
  color: 'var(--ink)',
  fontSize: 'var(--fs-sm)',
  minWidth: 0,
  overflow: 'hidden',
};
const ellipsis = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// 学生端可用：组件已配置、本段 coach 为真、没在回看（K5：useComponent().viewedStage.isLive）
function useStudentCoach() {
  const c = useComponent(ID);
  const stageId = c.currentStage.id;
  const coach = useCoachStage(stageId);
  const reviewing = c.viewedStage?.isLive === false;
  const ready = c.role === 'student' && c.data.perClass?.enabled === true && coach.on && !reviewing;
  return { c, stageId, coach, ready, reviewing };
}

function StudentBanner() {
  const { c, coach, ready } = useStudentCoach();
  if (!ready || c.data.perClass?.paused === true) return null;
  const text = coach.intro ?? TEXT.intro;
  return (
    <div data-coach-banner="" style={bannerRow}>
      <span title={text} style={{ ...ellipsis, flex: '1 1 auto' }}>{text}</span>
      <Btn size="sm" variant="primary" aria-haspopup="dialog" onClick={() => c.setLocal({ open: true })}>{TEXT.ask}</Btn>
    </div>
  );
}

// 回答正文：有代码行时分段（文字段 pre-wrap，代码段 <CodeView>），外层是纵向 flex 的块；没有代码行时原样一个 <span>
export function AnswerText({ text, style }) {
  const segs = codeSegments(text);
  if (!segs.some((x) => x.code)) return <span style={style}>{text}</span>;
  return (
    <div data-coach-answer="" style={{ ...style, display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
      {segs.map((x, i) => (x.code
        ? <CodeView key={i} code={x.text} size="sm" wrap />
        : <span key={i}>{x.text}</span>))}
    </div>
  );
}

function AskItem({ a }) {
  const failed = a.status !== 'ok';
  return (
    <li data-coach-ask={a.status} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', paddingBottom: 'var(--sp-2)', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.q || '（没写问题）'}</span>
      {a.status === 'refused' ? (
        <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.a}</span>
      ) : failed ? (
        <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>{a.status === 'limited' ? TEXT.limited : TEXT.failed}</span>
      ) : (
        <AnswerText text={a.a} style={{ background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-2) var(--sp-3)', color: 'var(--ink)', fontSize: 'var(--fs-md)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} />
      )}
    </li>
  );
}

// §12.1 求助类型单选：四个 Chip（本段没有 ok 回答时不显示 follow）
const kindBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 'var(--control-h)',
  padding: 0,
  background: 'none',
  border: 'none',
  font: 'inherit',
  cursor: 'pointer',
};

function KindPicker({ kinds, value, onChange }) {
  return (
    <div role="radiogroup" aria-label="求助类型" data-coach-kinds="">
      <Row gap={2}>
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} data-coach-kind={k} onClick={() => onChange(k)} style={kindBtn}>
            <Chip tone={value === k ? 'brand' : 'outline'}>{KIND_LABEL[k]}</Chip>
          </button>
        ))}
      </Row>
    </div>
  );
}

function Drawer({ c, stageId }) {
  const rec = c.data.my;
  const limits = limitsOf(c.options);
  const paused = c.data.perClass?.paused === true;
  const asks = stageAsks(rec, stageId);
  const total = asksOf(rec).length;
  const left = Math.max(0, limits.maxPerStage - usedIn(rec, stageId));
  const [question, setQuestion] = useState('');
  const [picked, setPicked] = useState(DEFAULT_KIND);
  const hasOk = asks.some((a) => a.status === 'ok');
  const kinds = hasOk ? KINDS : KINDS.filter((k) => k !== 'follow');
  const kind = kinds.includes(picked) ? picked : DEFAULT_KIND;
  const [now, setNow] = useState(() => Date.now());
  const pending = c.slice?.pending ?? null;
  const waiting = Boolean(pending) && pending.stageId === stageId && total <= pending.total;
  const { setLocal } = c;

  // 回答到了（asks 变长）或超过等待上限 → 解除在途
  useEffect(() => {
    if (!pending) return undefined;
    if (!waiting) {
      setLocal({ pending: null });
      return undefined;
    }
    const t = setTimeout(() => setLocal({ pending: null }), Math.max(0, pending.at + PENDING_MS - Date.now()));
    return () => clearTimeout(t);
  }, [pending, waiting, setLocal]);

  const wait = Math.max(cooldownLeft(rec, limits.cooldownMs, now), refusedLeft(rec, stageId, limits, now));
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wait > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  const notice = paused ? studentNotice({ rec, stageId, limits, paused }) : waiting ? null : studentNotice({ rec, stageId, limits, now });
  const followShort = kind === 'follow' && Array.from(question.trim()).length < FOLLOW_MIN;
  const canSend = !paused && !waiting && left > 0 && wait <= 0 && !followShort;
  const close = () => setLocal({ open: false });

  const send = () => {
    if (!canSend) return;
    const payload = { kind, question: question.slice(0, QUESTION_MAX) };
    const draft = readDraftCode({ lessonId: c.lesson.id, classEpoch: c.classEpoch, name: c.me?.name, stageId });
    if (draft !== undefined) payload.draft = draft;
    setLocal({ pending: { stageId, total, at: Date.now() } });
    c.send('coach:s-ask', payload);
    setQuestion('');
  };

  return (
    <Overlay variant="drawer" label="问 AI 要个提示" testId="coach-drawer" onDismiss={close}>
      <div style={{ width: '100%', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto', textAlign: 'left', color: 'var(--ink)' }}>
        <Stack gap={3}>
          <Row gap={2} wrap={false}>
            <span data-coach-hint="" style={{ flex: 1, minWidth: 0, color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>{kind === 'follow' ? TEXT.followHint : TEXT.hint}</span>
            <Chip tone={left > 0 ? 'brand' : 'warn'}><span data-coach-left="">{TEXT.remaining(left)}</span></Chip>
            <Btn variant="ghost" aria-label="收起" onClick={close}>✕</Btn>
          </Row>
          <KindPicker kinds={kinds} value={kind} onChange={setPicked} />
          <textarea
            value={question}
            maxLength={QUESTION_MAX}
            rows={3}
            aria-label="你的问题"
            onChange={(e) => setQuestion(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 'var(--sp-2)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              font: 'inherit',
              fontSize: 'var(--fs-md)',
              resize: 'vertical',
            }}
          />
          <Row gap={2} wrap={false}>
            <span data-coach-notice="" style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: notice?.tone === 'bad' ? 'var(--bad)' : notice?.tone === 'warn' ? 'var(--warn)' : 'var(--ink-soft)' }}>
              {notice?.text ?? ''}
            </span>
            <Btn variant="primary" disabled={!canSend} onClick={send}>{waiting ? TEXT.thinking : TEXT.send}</Btn>
          </Row>
          {asks.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {[...asks].reverse().map((a, i) => <AskItem key={a.id ?? i} a={a} />)}
            </ul>
          )}
        </Stack>
      </div>
    </Overlay>
  );
}

function StudentOverlay() {
  const { c, stageId, ready, reviewing } = useStudentCoach();
  const open = Boolean(c.slice?.open);
  const { setLocal } = c;
  // 回看时关掉抽屉（回到当前段不自动再开）
  useEffect(() => {
    if (reviewing && open) setLocal({ open: false });
  }, [reviewing, open, setLocal]);
  if (!ready || !open) return null;
  return <Drawer c={c} stageId={stageId} />;
}

// ---------- 教师端 ----------

// perClass 为空（还没拿到数据，如重置后教师端 stageData 被清空）与 enabled:false（服务端判定未配置）分开：
// 前者显示中性"AI 助手"，只有后者显示"未配置"
function TeacherToolbar() {
  const c = useComponent(ID);
  if (c.role !== 'teacher') return null;
  const enabled = c.data.perClass?.enabled;
  if (typeof enabled !== 'boolean') {
    return (
      <HelpTip text={TEXT.toolbarHelp}>
        <Chip tone="neutral"><span data-coach-chip="unknown">{TEXT.label}</span></Chip>
      </HelpTip>
    );
  }
  if (enabled === false) {
    return (
      <HelpTip text={TEXT.notConfiguredHelp}>
        <Chip tone="warn"><span data-coach-chip="off">{TEXT.notConfigured}</span></Chip>
      </HelpTip>
    );
  }
  // §12.6 已配置：按钮，点一下暂停 / 恢复（等服务端 class-update 回来再变文案）
  const paused = c.data.perClass?.paused === true;
  return (
    <HelpTip text={TEXT.toolbarHelp}>
      <Btn
        variant="soft"
        size="sm"
        data-coach-chip={paused ? 'paused' : 'on'}
        aria-pressed={paused}
        onClick={() => c.send('coach:t-pause', { paused: !paused })}
        style={paused ? { background: 'var(--warn-soft)', color: 'var(--warn)' } : undefined}
      >
        {paused ? TEXT.pausedBtn : TEXT.answered(answeredCount(c.data.perStudent))}
      </Btn>
    </HelpTip>
  );
}

function HelpRow({ row, open, onToggle }) {
  const chip = STATUS_CHIP[row.status];
  return (
    <li style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        type="button"
        data-coach-row={row.name}
        aria-expanded={open}
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          width: '100%',
          minHeight: 'var(--control-h)',
          padding: 'var(--sp-1) 0',
          background: 'none',
          border: 'none',
          color: row.connected ? 'var(--ink)' : 'var(--ink-dim)',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontWeight: 600 }}>{row.name}</span>
        <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>· {row.count} 次</span>
        {chip && <Chip tone={chip.tone}>{chip.text}</Chip>}
        {row.refused > 0 && <span data-coach-refused=""><Chip tone="warn">{TEXT.refusedFlag(row.refused)}</Chip></span>}
        {row.flagged && <span data-coach-flag=""><Chip tone="bad">{TEXT.flag}</Chip></span>}
      </button>
      {open && (
        <ul data-coach-detail={row.name} style={{ listStyle: 'none', margin: 0, padding: '0 0 var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {[...row.asks].reverse().map((a, i) => (
            <li key={a.id ?? i} data-coach-item={a.status} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
              <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {askMeta(a) && <span data-coach-meta="" style={{ color: 'var(--ink-soft)', fontWeight: 600, marginRight: 'var(--sp-2)' }}>{askMeta(a)}</span>}
                {a.q || '（没写问题）'}
              </span>
              {a.status === 'ok' ? (
                <AnswerText text={a.a} style={{ color: 'var(--ink)', fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} />
              ) : a.status === 'refused' ? (
                <span data-coach-refused-tag="" style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>{refusedTagOf(a)}</span>
              ) : (
                <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>{STATUS_CHIP[a.status]?.text ?? a.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function TeacherSidebar({ stageId }) {
  const c = useComponent(ID);
  const coach = useCoachStage(stageId);
  const { roster } = useTeacherStage(stageId);
  const [open, setOpen] = useState(null);
  if (c.role !== 'teacher' || !coach.on) return null;
  const rows = helpRows({
    perStudent: c.data.perStudent,
    stageId,
    records: c.stageData(stageId).perStudent,
    primitive: coach.primitive,
    roster,
    maxPerStage: limitsOf(c.options).maxPerStage,
  });
  return (
    <div data-coach-sidebar="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0 }}>
      <span style={{ color: 'var(--ink)', fontSize: 'var(--fs-md)', fontWeight: 600 }}>求助</span>
      {rows.length === 0 ? (
        <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>还没有人问</span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((row) => (
            <HelpRow key={row.name} row={row} open={open === row.name} onToggle={() => setOpen(open === row.name ? null : row.name)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default {
  slots: {
    studentBanner: StudentBanner,
    studentOverlay: StudentOverlay,
    teacherToolbar: TeacherToolbar,
    teacherSidebar: TeacherSidebar,
  },
  store: {
    student: { initial: { open: false, pending: null }, on: {} },
    teacher: { initial: {}, on: {} },
  },
};
