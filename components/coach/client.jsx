// coach 组件客户端（coach 组件规格 §3、§6、§12）
// 学生端：studentBanner 一行"卡住了？… [问一下]"（本段 coach 为真、组件已配置、没在回看、老师没暂停时）；studentOverlay 是点"问一下"后的 drawer
//   （说明、四个求助类型 Chip 单选、输入框 ≤ 500 字、发送、本段历史问答、还能问 N 次）。回答经组件数据到达（data.my.asks 最后一项），不另发事件。
//   §12.1：缺省 think；本段没有 ok 回答时不显示 follow；follow 要写 ≥ 4 字才能发。§12.6：暂停时抽屉一行"老师暂停了 AI 助手"并禁用发送。
//   draft：sandbox 编辑器草稿（localStorage，键由 draftKey 得到）；sandbox 没开或读不到就不带。
// 教师端（T9a，教师视图与学生页重排规格 §2.1：状态不当按钮摆在操作条）：teacherToolbar 渲染 null；
//   teacherPrelogin（课前页一行）：服务端判定未配置（perClass.enabled === false）时一句"AI 助手没配置，学生不会看到求助入口；…"，其它情况不渲染；
//   teacherSidebar（统计视图 Side，本段 coach 为真时）"求助"标题行（AI 已配置时）：灰字"已答 N"（只数 ok）+ 线路提示 + 按钮"暂停"/"恢复"
//   （发 coach:t-pause；暂停中另有"已暂停"）；下面是"求助"名单：每条问答前缀求助类型与 L1–L3，被拒的灰字标原因，"索答 N 次"标记。
//   K8（§15）：perClass.aiNotice 为 route 2 → 标题行"备用线路"，带 error → "接口异常"，title 说明（暂停时不显示）；备用线路回答的条目灰字"（备用）"。
// U6（代码展示统一高亮规格 §4）：抽屉与教师侧栏里的回答按行分段——连续的"像代码的行"（codeLine.js 的 CODE_LINE，与服务端 sanitize 同一个正则）
//   并成一个 <CodeView size="sm" wrap>，其余文字仍 pre-wrap；没有代码行时照旧一个 <span>。学生的提问 q 不处理。
// C6（AI 对照要求逐条核规格 §3、§4.1）：
//   学生抽屉：本段有要求清单且本人本段记录有代码时多一个芯片"我做完了，帮我看看"（kind check，问题可空）；
//     check 的 ok 回答用 verdicts.parseVerdicts 按条渲染（✓ / ✗ / ？ + 要求原文 + 理由，rest 在下方），解析不出就按普通回答显示
//   教师侧栏："求助"上方一节"AI 看一遍"（本段有要求清单且 AI 已配置）：idle 两次确认发 coach:t-review start；
//     running "已看 k/N" + 停止；done / stopped 每条要求一行计数，点开是"没做到 / 没法确认"名单，失败的单独一行，"再看一遍"。
//     状态来自服务端只发教师的 coach:review-state（教师切片 reviews[stageId]），挂载时发 coach:t-review-get 取回；学生端不显示任何 review
// T9b（教师视图与学生页重排规格 §2.5）：宽屏"问一下"→ useDock().openDock('coach')，内容在内核右侧停靠面板（slots.studentDock，
//   dockTitle "AI 助手"；标题与 ✕ 由外壳画，面板里不再有"收起"）——原抽屉的内容（CoachPanel）原样搬进去；
//   窄屏（useNarrow）照旧 setLocal({ open: true }) 开 studentOverlay 的 drawer。面板换段保持打开、内容按当前段；
//   回看 / 本段没开 / 未配置时面板里一行提示（data-coach-dock-note），老师暂停时照旧是面板里的"老师暂停了 AI 助手"、发送禁用；
//   镜像与教师端 studentDock 返回 null（内核也不渲染面板）
import { useEffect, useState } from 'react';
import { useComponent, useTeacherStage, useDraft, useDock, useNarrow, Btn, Chip, CodeView, ConfirmAdvanceBtn, GroupTag, Overlay, Row, Stack } from '#kernel/client/index.js';
import { draftKey, readDraft } from '#components/sandbox/client/ui/draftStorage.js';
import { useCoachStage } from './stageConfig.js';
import { codeSegments } from './codeLine.js';
// C6 审查 2：教师端"已入会"信号（断线时 false，teacher:join-ok 后 true），重连后重取核对状态；公开入口没有这个信号
import { coreTeacherStore } from '#kernel/client/stores/coreTeacherStore.js';
import { parseVerdicts, codeOf, reviewNames as reviewEntries } from './verdicts.js';

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
export const KINDS = Object.freeze(['understand', 'think', 'debug', 'follow', 'check']);
export const DEFAULT_KIND = 'think';
export const KIND_LABEL = Object.freeze({
  understand: '看不懂题', think: '不知道怎么下手', debug: '报错 / 结果不对', follow: '追问上一条', check: '我做完了，帮我看看',
});
export const KIND_PREFIX = Object.freeze({ understand: '看不懂题', think: '怎么下手', debug: '报错', follow: '追问', check: '自查' });
// C6：逐条判断的图标、颜色令牌与读屏文字
export const VERDICT_ICON = Object.freeze({ done: '✓', missing: '✗', unsure: '？' });
const VERDICT_COLOR = { done: 'var(--good)', missing: 'var(--bad)', unsure: 'var(--warn)' };
const VERDICT_LABEL = { done: '做到了', missing: '没做到', unsure: '没法确认' };
const REVIEW_ROW_TEXT_MAX = 20;
// C6 审查 2：running 时每隔这么久再取一次核对状态兜底（断线期间漏掉的进度）
export const REVIEW_POLL_MS = 15000;

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
  // T9b：右侧面板里的一行提示
  dockReviewing: '回看时不能问 AI，回到当前段再问',
  dockOff: '这一段没开 AI 助手',
  remaining: (n) => `还能问 ${n} 次`,
  label: 'AI 助手',
  notConfigured: 'AI 助手未配置',
  // T9a：课前页一行与侧栏"求助"标题行
  preloginOff: 'AI 助手没配置，学生不会看到求助入口；要用就到管理台第 4 步"上课准备"填 AI 接口',
  answeredShort: (n) => `已答 ${n}`,
  pause: '暂停',
  resume: '恢复',
  pausedNote: '已暂停',
  pauseHelp: '随堂测验时可暂停 AI 助手：暂停期间学生看不到"问一下"，恢复后照常',
  routeBackup: '备用线路',
  routeError: '接口异常',
  flag: '多次求助未通过',
  refusedFlag: (n) => `索答 ${n} 次`,
  refusedTag: { answer: '（已拒绝：索要答案）', inject: '（已拒绝：无关请求）' },
  // K8（coach 规格 §15）：AI 线路提示
  backupTitle: (t) => `主接口从 ${t} 起不可用，已自动改用备用接口；课后到管理台设置页点"测一下"看看主接口`,
  errorTitle: (why) => `AI 接口最近一次请求失败（${why}），学生会看到"AI 现在没回应"`,
  backupTag: '（备用）',
  // C6：学生 check 与教师"AI 看一遍"
  checkHint: '可以不写，直接发',
  checkNote: 'AI 的判断，可能有错；测试结果为准',
  reviewTitle: 'AI 看一遍',
  reviewNote: 'AI 的判断，可能有错，只作讲评参考',
  reviewStart: (n) => `AI 帮我看一遍（${n} 人）`,
  reviewConfirm: (n) => `确定：会问 ${n} 次 AI`,
  reviewProgress: (k, n) => `已看 ${k}/${n}`,
  reviewStop: '停止',
  reviewStopped: (k, n) => `已停止（看了 ${k}/${n}）`,
  reviewAgain: '再看一遍',
  reviewRow: ({ n, text, done, missing, unsure }) => `第 ${n} 条 ${Array.from(String(text ?? '')).slice(0, REVIEW_ROW_TEXT_MAX).join('')}：✓ ${done} · ✗ ${missing} · ？ ${unsure}`,
  reviewMissing: '没做到',
  reviewUnsure: '没法确认',
  reviewFailed: (names) => `没看成：${names.join('、')}`,
  reviewReason: (name, reason) => `${name}：${reason || 'AI 没写理由'}`,
  reviewTruncated: '结果太多，保存时理由被截短了',
});

// K8：AI 失败原因的中文（教师工具栏 title）；与内核 kernel/server/ai.js 的 AI_REASON_TEXT / aiReasonText 一致（管理台"测一下"用那份，有单测对照）
export const REASON_TEXT = Object.freeze({
  timeout: '超时',
  network: '连不上',
  'http-401': '密钥不对',
  'http-403': '密钥不对',
  'http-404': '地址或模型名不对',
  'http-429': '太频繁',
  'http-5xx': '服务商故障',
  empty: '回复为空',
});
export function reasonText(reason) {
  if (typeof reason !== 'string' || reason === '') return '出错了';
  if (/^http-5\d\d$/.test(reason)) return REASON_TEXT['http-5xx'];
  return REASON_TEXT[reason] ?? `出错了（${reason}）`;
}
export function hhmm(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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
  const narrow = useNarrow();
  const dock = useDock();
  if (!ready || c.data.perClass?.paused === true) return null;
  const text = coach.intro ?? TEXT.intro;
  // T9b：宽屏开右侧面板，窄屏开 drawer
  const onAsk = () => (narrow ? c.setLocal({ open: true }) : dock.openDock(ID));
  const aria = narrow ? { 'aria-haspopup': 'dialog' } : { 'aria-expanded': dock.open === ID };
  return (
    <div data-coach-banner="" style={bannerRow}>
      <span title={text} style={{ ...ellipsis, flex: '1 1 auto' }}>{text}</span>
      <Btn size="sm" variant="primary" {...aria} onClick={onAsk}>{TEXT.ask}</Btn>
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

// C6：check 回答按条渲染（rows / rest 来自 parseVerdicts；调用方在解析不出任何一条时按普通回答显示）
function VerdictList({ rows, rest, requirements }) {
  return (
    <div data-coach-verdicts="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-2) var(--sp-3)' }}>
      <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>{TEXT.checkNote}</span>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
        {rows.map((r) => (
          <li key={r.n} data-coach-verdict={r.verdict} style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline', fontSize: 'var(--fs-md)', color: 'var(--ink)' }}>
            <span role="img" aria-label={VERDICT_LABEL[r.verdict]} style={{ color: VERDICT_COLOR[r.verdict], fontWeight: 600, flex: '0 0 auto' }}>{VERDICT_ICON[r.verdict]}</span>
            <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
              {requirements[r.n - 1] ?? `第 ${r.n} 条`}
              {r.note && <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)', marginLeft: 'var(--sp-2)' }}>{r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      {rest && <span data-coach-verdict-rest="" style={{ color: 'var(--ink)', fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{rest}</span>}
    </div>
  );
}

function AskItem({ a, requirements = [] }) {
  const failed = a.status !== 'ok';
  const parsed = !failed && a.kind === 'check' ? parseVerdicts(a.a, requirements.length) : null;
  return (
    <li data-coach-ask={a.status} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', paddingBottom: 'var(--sp-2)', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.q || '（没写问题）'}</span>
      {a.status === 'refused' ? (
        <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.a}</span>
      ) : failed ? (
        <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>{a.status === 'limited' ? TEXT.limited : TEXT.failed}</span>
      ) : parsed && parsed.rows.length > 0 ? (
        <VerdictList rows={parsed.rows} rest={parsed.rest} requirements={requirements} />
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

// 抽屉 / 右侧面板共用的内容（T9b：原 Drawer 的内容原样搬出）；onClose 给了才显示自己的"收起"（面板的 ✕ 由外壳画）
function CoachPanel({ c, stageId, coach, onClose }) {
  const rec = c.data.my;
  const limits = limitsOf(c.options);
  const paused = c.data.perClass?.paused === true;
  const asks = stageAsks(rec, stageId);
  const total = asksOf(rec).length;
  const left = Math.max(0, limits.maxPerStage - usedIn(rec, stageId));
  // D1（学生输入自动保存规格 §2.4）：提问框自动保存（刷新、断线、关浏览器、换设备不丢），发送后清掉
  const [questionRaw, setQuestion, { clear: clearQuestion }] = useDraft('question', '', { stageId: 'component:coach' });
  const question = typeof questionRaw === 'string' ? questionRaw : '';
  const [picked, setPicked] = useState(DEFAULT_KIND);
  const hasOk = asks.some((a) => a.status === 'ok');
  // C6：check 只在本段有要求清单且本人本段记录有代码时出现
  const requirements = Array.isArray(coach?.requirements) ? coach.requirements : [];
  const canCheck = requirements.length > 0 && coach?.hasCode === true;
  const kinds = KINDS.filter((k) => (k !== 'follow' || hasOk) && (k !== 'check' || canCheck));
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

  const send = () => {
    if (!canSend) return;
    const payload = { kind, question: question.slice(0, QUESTION_MAX) };
    const draft = readDraftCode({ lessonId: c.lesson.id, classEpoch: c.classEpoch, name: c.me?.name, stageId });
    if (draft !== undefined) payload.draft = draft;
    setLocal({ pending: { stageId, total, at: Date.now() } });
    c.send('coach:s-ask', payload);
    clearQuestion();
  };

  return (
    <div data-coach-panel="" style={{ width: '100%', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto', textAlign: 'left', color: 'var(--ink)' }}>
      <Stack gap={3}>
        <Row gap={2} wrap={false}>
          <span data-coach-hint="" style={{ flex: 1, minWidth: 0, color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>{kind === 'follow' ? TEXT.followHint : kind === 'check' ? TEXT.checkHint : TEXT.hint}</span>
          <Chip tone={left > 0 ? 'brand' : 'warn'}><span data-coach-left="">{TEXT.remaining(left)}</span></Chip>
          {onClose && <Btn variant="ghost" aria-label="收起" onClick={onClose}>✕</Btn>}
        </Row>
        <KindPicker kinds={kinds} value={kind} onChange={setPicked} />
        <textarea
          value={question}
          maxLength={QUESTION_MAX}
          rows={3}
          aria-label="你的问题"
          placeholder={kind === 'check' ? TEXT.checkHint : undefined}
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
            {[...asks].reverse().map((a, i) => <AskItem key={a.id ?? i} a={a} requirements={requirements} />)}
          </ul>
        )}
      </Stack>
    </div>
  );
}

function Drawer({ c, stageId, coach }) {
  const close = () => c.setLocal({ open: false });
  return (
    <Overlay variant="drawer" label="问 AI 要个提示" testId="coach-drawer" onDismiss={close}>
      <CoachPanel c={c} stageId={stageId} coach={coach} onClose={close} />
    </Overlay>
  );
}

// T9b：右侧停靠面板（宽屏）。回看 / 本段没开 / 未配置时一行提示；perClass 还没到时空着
const dockNote = { color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 };
function StudentDock() {
  const { c, stageId, coach, ready, reviewing } = useStudentCoach();
  if (c.role !== 'student') return null;
  if (ready) return <CoachPanel c={c} stageId={stageId} coach={coach} />;
  const enabled = c.data.perClass?.enabled;
  let note = null;
  if (enabled === false) note = TEXT.notConfigured;
  else if (enabled !== true) note = null;
  else if (reviewing) note = TEXT.dockReviewing;
  else if (!coach.on) note = TEXT.dockOff;
  return note ? <div data-coach-dock-note="" style={dockNote}>{note}</div> : null;
}

function StudentOverlay() {
  const { c, stageId, coach, ready, reviewing } = useStudentCoach();
  const open = Boolean(c.slice?.open);
  const { setLocal } = c;
  // 回看时关掉抽屉（回到当前段不自动再开）
  useEffect(() => {
    if (reviewing && open) setLocal({ open: false });
  }, [reviewing, open, setLocal]);
  if (!ready || !open) return null;
  return <Drawer c={c} stageId={stageId} coach={coach} />;
}

// ---------- 教师端 ----------

// T9a：操作条上不再有 AI 助手芯片；槽位保留但渲染 null（状态改到课前页与侧栏"求助"标题行）
function TeacherToolbar() {
  return null;
}

// T9a：课前页一行——只在服务端判定未配置（enabled: false）时提示；perClass 为空（还没拿到数据，如重置后）不提示
function TeacherPrelogin() {
  const c = useComponent(ID);
  if (c.role !== 'teacher' || c.data.perClass?.enabled !== false) return null;
  return <span data-coach-prelogin="" style={{ color: 'var(--warn)' }}>{TEXT.preloginOff}</span>;
}

// T9a：侧栏"求助"标题行的状态（AI 已配置时）：已答 N（只数 ok）· 线路提示（K8）· 暂停 / 恢复（§12.6，等服务端 class-update 回来再变）
function CoachStatus({ c }) {
  if (c.data.perClass?.enabled !== true) return null;
  const paused = c.data.perClass?.paused === true;
  const notice = isPlainObject(c.data.perClass?.aiNotice) ? c.data.perClass.aiNotice : null;
  const kind = paused || !notice ? null : notice.error ? 'error' : notice.route === 2 ? 'backup' : null;
  const title = kind === 'error' ? TEXT.errorTitle(reasonText(notice.error))
    : kind === 'backup' ? TEXT.backupTitle(hhmm(notice.since))
      : undefined;
  const dim = { color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' };
  return (
    <span data-coach-status={paused ? 'paused' : 'on'} style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-2)', minWidth: 0 }}>
      <span data-coach-answered="" style={dim}>{TEXT.answeredShort(answeredCount(c.data.perStudent))}</span>
      {kind && (
        <span data-coach-route={kind} title={title} style={{ ...dim, color: kind === 'error' ? 'var(--bad)' : 'var(--warn)' }}>
          {kind === 'error' ? TEXT.routeError : TEXT.routeBackup}
        </span>
      )}
      {paused && <span data-coach-paused="" style={{ ...dim, color: 'var(--warn)' }}>{TEXT.pausedNote}</span>}
      <Btn
        variant="soft"
        size="sm"
        data-coach-pause=""
        aria-pressed={paused}
        title={TEXT.pauseHelp}
        onClick={() => c.send('coach:t-pause', { paused: !paused })}
      >
        {paused ? TEXT.resume : TEXT.pause}
      </Btn>
    </span>
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
                {a.route === 2 && <span data-coach-backup="" style={{ color: 'var(--ink-dim)', marginLeft: 'var(--sp-2)' }}>{TEXT.backupTag}</span>}
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

// ---------- C6：教师"AI 看一遍" ----------

export const reviewOf = (slice, stageId) => {
  const r = slice?.reviews?.[stageId];
  return isPlainObject(r) ? r : null;
};
// 第 n 条要求在各生回答里判为 verdict 的名单（只看 status ok 的学生，按名字排序）
export const reviewNames = (perStudent, n, verdict) => reviewEntries(perStudent, n, verdict).map((e) => e.name);
export const reviewFailedNames = (perStudent) => Object.entries(isPlainObject(perStudent) ? perStudent : {})
  .filter(([, s]) => s?.status === 'failed')
  .map(([name]) => name)
  .sort((a, b) => a.localeCompare(b, 'zh'));

const reviewRowBtn = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  minHeight: 'var(--control-h)',
  padding: 'var(--sp-1) 0',
  background: 'none',
  border: 'none',
  color: 'var(--ink)',
  font: 'inherit',
  fontSize: 'var(--fs-sm)',
  textAlign: 'left',
  cursor: 'pointer',
};

const reviewNameBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: 'var(--sp-1)',
  background: 'none',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  font: 'inherit',
  cursor: 'pointer',
};

// C7：名字是按钮，点开 / 收起该生这一条的理由（picked 为当前展开的名字，只展开一个）
function ReviewNames({ label, entries, color, attr, picked, onPick }) {
  if (entries.length === 0) return null;
  const hit = entries.find((e) => e.name === picked);
  return (
    <div {...{ [attr]: '' }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', fontSize: 'var(--fs-sm)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)', alignItems: 'center' }}>
        <span style={{ color: 'var(--ink-soft)' }}>{label}</span>
        {entries.map((e) => (
          <button
            key={e.name}
            type="button"
            data-coach-review-name={e.name}
            aria-expanded={picked === e.name}
            onClick={() => onPick(picked === e.name ? null : e.name)}
            style={{ ...reviewNameBtn, background: picked === e.name ? 'var(--surface-alt)' : 'none' }}
          >
            <GroupTag label={e.name} color={color} size="md" />
          </button>
        ))}
      </div>
      {hit && (
        <span data-coach-review-reason="" style={{ color: 'var(--ink)', wordBreak: 'break-word', paddingLeft: 'var(--sp-2)' }}>
          {TEXT.reviewReason(hit.name, hit.reason)}
        </span>
      )}
    </div>
  );
}

function ReviewPanel({ c, stageId }) {
  const [open, setOpen] = useState(null);
  // C7：展开的学生理由 { verdict, name }；换一条要求时收起
  const [pick, setPick] = useState(null);
  const r = reviewOf(c.slice, stageId);
  const status = r?.status ?? 'idle';
  const { send } = c;
  // 审查 2：running 时每 15 s 取一次兜底
  useEffect(() => {
    if (status !== 'running') return undefined;
    const t = setInterval(() => send('coach:t-review-get', { stageId }), REVIEW_POLL_MS);
    return () => clearInterval(t);
  }, [status, stageId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const records = c.stageData(stageId).perStudent ?? {};
  const n = Object.values(records).filter((rec) => codeOf(rec) !== '').length;
  const start = () => c.send('coach:t-review', { stageId, action: 'start' });
  const startBtn = (label) => (
    <ConfirmAdvanceBtn variant="soft" size="sm" disabled={n === 0} confirmLabel={TEXT.reviewConfirm(n)} onAdvance={start}>{label}</ConfirmAdvanceBtn>
  );
  const summary = Array.isArray(r?.summary) ? r.summary : [];
  const failedNames = reviewFailedNames(r?.perStudent);
  return (
    <div data-coach-review={status} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0 }}>
      <span style={{ color: 'var(--ink)', fontSize: 'var(--fs-md)', fontWeight: 600 }}>{TEXT.reviewTitle}</span>
      <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>{TEXT.reviewNote}</span>
      {status === 'running' ? (
        <Row gap={2} wrap={false}>
          <span data-coach-review-progress="" style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink)' }}>{TEXT.reviewProgress(r.done ?? 0, r.total ?? 0)}</span>
          <Btn variant="soft" size="sm" onClick={() => c.send('coach:t-review', { stageId, action: 'stop' })}>{TEXT.reviewStop}</Btn>
        </Row>
      ) : status === 'done' || status === 'stopped' ? (
        <>
          {status === 'stopped' && <span style={{ color: 'var(--warn)', fontSize: 'var(--fs-sm)' }}>{TEXT.reviewStopped(r.done ?? 0, r.total ?? 0)}</span>}
          {r.truncated === true && <span data-coach-review-truncated="" style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>{TEXT.reviewTruncated}</span>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {summary.map((row) => (
              <li key={row.n} style={{ borderBottom: '1px solid var(--border)' }}>
                <button type="button" data-coach-review-row={row.n} aria-expanded={open === row.n} onClick={() => { setOpen(open === row.n ? null : row.n); setPick(null); }} style={reviewRowBtn}>
                  {TEXT.reviewRow(row)}
                </button>
                {open === row.n && (
                  <div data-coach-review-names={row.n} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', paddingBottom: 'var(--sp-2)' }}>
                    {[['missing', TEXT.reviewMissing, 'var(--bad)'], ['unsure', TEXT.reviewUnsure, 'var(--warn)']].map(([v, label, color]) => (
                      <ReviewNames
                        key={v}
                        label={label}
                        entries={reviewEntries(r.perStudent, row.n, v)}
                        color={color}
                        attr={`data-coach-review-${v}`}
                        picked={pick?.verdict === v ? pick.name : null}
                        onPick={(name) => setPick(name ? { verdict: v, name } : null)}
                      />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {failedNames.length > 0 && <span data-coach-review-failed="" style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)', wordBreak: 'break-word' }}>{TEXT.reviewFailed(failedNames)}</span>}
          <Row gap={2}>{startBtn(TEXT.reviewAgain)}</Row>
        </>
      ) : (
        <Row gap={2}>{startBtn(TEXT.reviewStart(n))}</Row>
      )}
    </div>
  );
}

function TeacherSidebar({ stageId }) {
  const c = useComponent(ID);
  const coach = useCoachStage(stageId);
  const { roster } = useTeacherStage(stageId);
  const [open, setOpen] = useState(null);
  const requirements = Array.isArray(coach.requirements) ? coach.requirements : [];
  // C6："AI 看一遍"——本段有要求清单且 AI 已配置（不看本段是否开了学生求助）
  const canReview = c.role === 'teacher' && requirements.length > 0 && c.data.perClass?.enabled === true;
  const { send } = c;
  // 挂载、换段、断线重连（joined 由 false 变 true）时取回核对状态
  const joined = coreTeacherStore((st) => st.joined) === true;
  useEffect(() => {
    if (canReview && joined) send('coach:t-review-get', { stageId });
  }, [canReview, stageId, joined]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (c.role !== 'teacher' || (!coach.on && !canReview)) return null;
  if (!coach.on) {
    return (
      <div data-coach-sidebar="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0 }}>
        <ReviewPanel c={c} stageId={stageId} />
      </div>
    );
  }
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
      {canReview && <ReviewPanel c={c} stageId={stageId} />}
      <div data-coach-help-head="" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-2)', minWidth: 0 }}>
        <span style={{ color: 'var(--ink)', fontSize: 'var(--fs-md)', fontWeight: 600, flex: '1 1 auto' }}>求助</span>
        <CoachStatus c={c} />
      </div>
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
    studentDock: StudentDock,
    dockTitle: TEXT.label,
    teacherToolbar: TeacherToolbar,
    teacherSidebar: TeacherSidebar,
    teacherPrelogin: TeacherPrelogin,
  },
  store: {
    student: { initial: { open: false, pending: null }, on: {} },
    // C6：coach:review-state（服务端只发教师）→ reviews[stageId]；classroom:reset 回 initial
    teacher: {
      initial: { reviews: {} },
      on: {
        'coach:review-state': (slice, p) => {
          if (!isPlainObject(p) || typeof p.stageId !== 'string') return slice;
          const base = isPlainObject(slice) ? slice : {};
          return { ...base, reviews: { ...(isPlainObject(base.reviews) ? base.reviews : {}), [p.stageId]: p } };
        },
      },
    },
  },
};
