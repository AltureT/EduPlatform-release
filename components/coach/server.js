// coach 组件服务端（coach 组件规格 §2、§4、§12）
// 数据（stageId component:coach）：perClass = { enabled, reason: null | '未配置', paused: boolean, aiNotice: null | { route, since, error? } }；
//   perStudent[name] = { asks: [{ id, stageId, at, kind, level, q, a, status: 'ok'|'failed'|'limited'|'refused', ms, err?, route? }]（最近 50 条；route 只在备用线路回答时写 2）,
//                        byStage: { [stageId]: 次数 } }
// C4（AI 助手上下文规格）：调模型时另组装 earlier（当前段之前有沙盒的最近 2 段）、teacherCode（本段 perClass.pushedCode.code）、
//   now（progress 用）；ok / failed 记录带 err（提问时本段记录报错首行，≤ 80，没有报错就没有该键），下一轮随 previous 发出
// §12：coach:s-ask 带 kind（understand | think | debug | follow）；level = min(3, 本段 ok 次数 + 1)；
//   输入规则（guard.screen）命中 → 不调模型，落一条 refused（a 为固定回复）并计次；本段 refused ≥ 3 → 额外冷却 refusedCooldownMs；
//   coach:t-pause { paused }：教师暂停 / 恢复（t- 前缀由内核分发按角色放行，只有教师 socket 能发）；重置清掉暂停
// V2（代码题批改规格 §4.4）：本段记录有 mistake.id 且阶段 options.mistakes（code 原语的错误库，服务端版）里查得到 →
//   buildUser 另收 mistake = { label, hint }（老师预判的错误类型与预写提示）
// C6（AI 对照要求逐条核规格）：
//   学生 kind check（"我做完了，帮我看看"）：本段要有要求清单（requirementsOf）且本段记录有代码（codeOf），否则 reject；
//     question 为空时不走输入规则；计次、level 照常，回答风格固定为 ASK_STYLE.check
//   教师 coach:t-review { stageId, action: start | stop } / coach:t-review-get { stageId }：对当前段或已过的段、有要求清单，
//     把本段有代码的学生（最终稿优先）按名字排序逐个交给 ai.chat（caller coach-review，组件级名额：所有 review 合计同时在途 ≤ 2，crowded 等 2 s 重试一次），
//     sanitize 后 parseVerdicts（C7：rows 存成 { n, verdict, reason ≤ 200 }）；状态在服务端内存、另存 teacherData（见下），经 coach:review-state 只发教师（进度节流 300 ms；get 只回发请求的 socket）；
//     不写 cctx.data，不进学生记录；重置清空并对看过的段各发一次 idle。
//     事件名：内核 emit 不允许带 t- 段（component-context checkEmit），规格写的 coach:t-review-state 改为 coach:review-state
// C7（结果持久化）：核对状态另存内核教师专属存储 cctx.teacherData 'review:<stageId>' =
//     { status, startedAt, finishedAt, total, done, failed, summary, perStudent: { [name]: { status, rows: [{ n, verdict, reason }] } }, truncated? }
//   开始、每名学生完成、结束 / 停止各写一次（fitStored 保证 ≤ 200 KB：先把理由截到 40 字，仍超只存 verdict，都标 truncated）；
//   register 时扫一遍载入内存（running → stopped 并写回），coach:t-review-get 照旧从内存回；重置由内核清表，coach 只清内存
// 隐私：发给模型的内容不含学生姓名；日志只记阶段、匿名代号、状态、耗时
// K6：调模型走内核统一接口 cctx.ai.chat(messages, { caller: 'coach' })（统一 AI 接口规格 §3）；
//   地址 / 模型 / 密钥、超时、全局并发（在途 8、排队 20，超出抛 AIError('crowded')）都由内核管；
//   perClass.enabled / reason 取自 cctx.ai.configured / reason
// 测试注入：导出的 testHooks.ai（createAI({ env, fetch })），register 时非 null 的优先；不走组件 options
//   （组件 options 会随 classroom:state 下发到客户端，课程配置里写 env 会泄露密钥）
import { shape } from '#kernel/server/schema.js';
import { SYSTEM, KINDS, MAX_LEVEL, LIMITS, buildUser, sanitize, errorHead } from './prompt.js';
import { screen, clean, REPLY, RECENT_COUNT } from './guard.js';
import { parseVerdicts, requirementsOf, codeOf, summarize, reviewRows } from './verdicts.js';
import { TEACHER_DATA_MAX_BYTES } from '#kernel/server/component-context.js';

export const DEFAULTS = Object.freeze({ maxPerStage: 5, cooldownMs: 20000, refusedCooldownMs: 60000 });
// 本段被拒达到这个数后开始额外冷却
export const REFUSED_STREAK = 3;
// follow 的 question 至少几个字
export const FOLLOW_MIN = 4;
const MAX_ASKS = 50;

export const MSG = Object.freeze({
  notOpen: '这一段没有开 AI 助手',
  notConfigured: 'AI 助手还没有配置',
  limited: '这一段的提问次数用完了',
  busy: '上一个问题还在等回答',
  crowded: '现在问的人太多，等一会再试',
  paused: '老师暂停了 AI 助手',
  followFirst: '先问一个问题',
  checkNoList: '这一段没有要求清单，AI 没法逐条看',
  checkNoCode: '先写代码、运行一次，再让 AI 帮你看',
  reviewNotReached: '这一段还没到，不能看',
  reviewNoStage: '没有这一段',
  reviewNoList: '这一段没有要求清单，AI 没法逐条看',
  cooldown: (n) => `刚问过，等 ${n} 秒再问`,
  refusedCooldown: (n) => `刚被拒过几次，等 ${n} 秒再问`,
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonNegInt = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);

// 阶段 stage.config.js 顶层 coach：true | false | { intro }；对象视为开
export const coachOn = (config) => config?.coach === true || isPlainObject(config?.coach);
// C4：有沙盒的段 = 原语 code / data-analysis，或自写段配置里有 sandbox
const SANDBOX_PRIMITIVES = new Set(['code', 'data-analysis']);
// C6 审查 4：教师核对用的记录——有最终稿就整份取最终稿（code / stdout / error / tests，提交时刻当最近运行），否则原样
export function reviewRecord(record) {
  const r = isPlainObject(record) ? record : {};
  const fin = r.final;
  if (!isPlainObject(fin) || typeof fin.code !== 'string' || fin.code.trim() === '') return { ...r, code: codeOf(r) };
  return {
    ...r,
    code: fin.code,
    stdout: typeof fin.stdout === 'string' ? fin.stdout : '',
    error: fin.error ?? null,
    tests: isPlainObject(fin.tests) ? fin.tests : null,
    ...(Number.isFinite(fin.at) ? { submittedAt: fin.at } : {}),
  };
}
export const hasSandbox = (config) => SANDBOX_PRIMITIVES.has(config?.primitive) || isPlainObject(config?.sandbox);
const EARLIER_COUNT = LIMITS.earlierCount;

export const askShape = shape({
  kind: `enum:${KINDS.join(',')}`,
  question: 'string:0-500',
  draft: 'optional:string:0-20000',
});
export const pauseShape = shape({ paused: 'boolean' });
export const reviewShape = shape({ stageId: 'string:1-200', action: 'enum:start,stop' });
export const reviewGetShape = shape({ stageId: 'string:1-200' });
export const REVIEW_EVENT = 'coach:review-state';
// C6：教师批量核对同时在途数、进度节流、crowded 重试等待
export const REVIEW_CONCURRENCY = 2;
export const REVIEW_THROTTLE_MS = 300;
export const REVIEW_RETRY_MS = 2000;

// C7：存储超限时理由截到的字数；存储键前缀
export const REVIEW_REASON_SHORT = 40;
const REVIEW_KEY = 'review:';
const REVIEW_STATUSES = new Set(['running', 'done', 'stopped']);
const bytesOf = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const mapRows = (stored, fn) => ({
  ...stored,
  perStudent: Object.fromEntries(Object.entries(stored.perStudent).map(([name, s]) => [name, { ...s, rows: s.rows.map(fn) }])),
});
// 存储形状 ≤ max：原样 → 理由截到 REVIEW_REASON_SHORT 字（truncated）→ 只存 verdict（truncated）→ 仍超 null（不存）
export function fitStored(stored, max = TEACHER_DATA_MAX_BYTES) {
  if (bytesOf(stored) <= max) return stored;
  const short = mapRows({ ...stored, truncated: true }, (r) => ({ ...r, reason: Array.from(String(r.reason ?? '')).slice(0, REVIEW_REASON_SHORT).join('') }));
  if (bytesOf(short) <= max) return short;
  const bare = mapRows({ ...stored, truncated: true }, (r) => ({ n: r.n, verdict: r.verdict }));
  return bytesOf(bare) <= max ? bare : null;
}

// K8 审查：每次调模型的超时。填了备用接口时一次请求最长约 2 × 20 s，排队再等一轮也在客户端 PENDING_MS（90 s）以内
export const COACH_TIMEOUT_MS = 20000;

// 只供测试：register 之前赋值，测试结束后置回 null（timeoutMs 覆盖 COACH_TIMEOUT_MS；
//   reviewThrottleMs / reviewRetryMs 覆盖 REVIEW_THROTTLE_MS / REVIEW_RETRY_MS，调用时读）
export const testHooks = { ai: null, timeoutMs: null, reviewThrottleMs: null, reviewRetryMs: null };
const hookOr = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);

// K8（coach 规格 §15、AI 备用线路规格 §4）：由 ai.status() 与本次回答的线路得出教师端提示
//   已配置的线路都 down → { route: 第一条已配置的线路, error: 它的 lastError, since }（"接口异常"）；
//   两条都配置、且主线路 down 或本次走的是 2 → { route: 2, since: 主线路不可用起的时刻 }（"备用线路"）；否则 null。
//   ai 没有 status()（测试里的假对象）→ null
export function noticeOf(ai, route = null) {
  if (typeof ai?.status !== 'function') return null;
  let st;
  try {
    st = ai.status();
  } catch {
    return null;
  }
  const routes = Array.isArray(st?.routes) ? st.routes.filter(isPlainObject) : [];
  const conf = routes.filter((r) => r.configured === true);
  if (conf.length === 0) return null;
  if (conf.every((r) => r.down === true)) {
    const r0 = conf[0];
    return { route: r0.route, error: typeof r0.lastError === 'string' ? r0.lastError : null, since: Number.isFinite(r0.since) ? r0.since : Date.now() };
  }
  const main = routes.find((r) => r.route === 1);
  if (conf.length === 2 && (main?.down === true || route === 2)) {
    return { route: 2, since: Number.isFinite(main?.since) ? main.since : Date.now() };
  }
  return null;
}

export function register(cctx) {
  const o = cctx.options ?? {};
  const ai = testHooks.ai ?? cctx.ai;
  const maxPerStage = nonNegInt(o.maxPerStage, DEFAULTS.maxPerStage);
  const cooldownMs = nonNegInt(o.cooldownMs, DEFAULTS.cooldownMs);
  const refusedCooldownMs = nonNegInt(o.refusedCooldownMs, DEFAULTS.refusedCooldownMs);
  const isConfigured = ai?.configured === true;
  const reason = isConfigured ? null : (ai?.reason ?? '未配置');

  // 每人在途（内存，重启 / 重置清空；generation 在重置时加一，丢弃重置前发出的请求结果）；全局并发与排队在内核 ai
  let generation = 0;
  let inflight = new Set();
  let seq = 0;
  let paused = false;

  // K8（coach 规格 §15）：内核 AI 线路状态 → perClass.aiNotice（教师工具栏提示）；进程级状态，重置不清
  let aiNotice = noticeOf(ai);
  const publish = () => cctx.data.setClass({ enabled: isConfigured, reason, paused, aiNotice });
  publish();
  const refreshNotice = (route) => {
    const next = noticeOf(ai, route);
    if (JSON.stringify(next) === JSON.stringify(aiNotice)) return;
    aiNotice = next;
    publish();
  };

  const stageOf = (id) => cctx.stages.list().find((s) => s.id === id) ?? null;
  const recordOf = (name) => cctx.data.get(name) ?? {};
  // C4 earlier：当前段之前、有沙盒的段里最近的 EARLIER_COUNT 段；那段没有该生记录就不带；代码取最终稿，没有取最近运行的
  const earlierOf = (name, stageId) => {
    const list = cctx.stages.list();
    const i = list.findIndex((s) => s.id === stageId);
    if (i <= 0) return [];
    return list.slice(0, i).filter((s) => hasSandbox(s.config)).slice(-EARLIER_COUNT).flatMap((s) => {
      const r = cctx.stages.data(s.id).get(name);
      if (!isPlainObject(r)) return [];
      const fin = isPlainObject(r.final) && typeof r.final.code === 'string' ? r.final.code : null;
      return [{
        label: s.label ?? s.id, ran: Number(r.runs) >= 1, passed: r.firstPassedAt != null, code: fin ?? (typeof r.code === 'string' ? r.code : ''),
      }];
    });
  };

  const optionsOf = (stage) => (isPlainObject(stage?.config?.options) ? stage.config.options : {});
  // 组装 user JSON（s-ask 与 C6 review 共用）：本段 options、earlier、老师下发的代码、老师预判的错误类型
  const userFor = ({ name, stage, record, draft, question, previous, kind, level, now }) => {
    const options = optionsOf(stage);
    const mid = isPlainObject(record?.mistake) ? record.mistake.id : null;
    const lib = Array.isArray(options.mistakes?.mistakes) ? options.mistakes.mistakes : [];
    const hit = typeof mid === 'string' ? lib.find((m) => isPlainObject(m) && m.id === mid) : null;
    return buildUser({
      stage,
      options,
      record,
      draft,
      question,
      previous,
      ask: { kind, level },
      earlier: earlierOf(name, stage.id),
      teacherCode: cctx.stages.data(stage.id).getClass()?.pushedCode?.code,
      mistake: hit ? { label: hit.label, hint: hit.hint } : undefined,
      now,
    });
  };

  const append = (name, entry) => {
    const rec = recordOf(name);
    const asks = Array.isArray(rec.asks) ? rec.asks : [];
    const byStage = isPlainObject(rec.byStage) ? rec.byStage : {};
    cctx.data.set(name, {
      asks: [...asks, entry].slice(-MAX_ASKS),
      byStage: { ...byStage, [entry.stageId]: (byStage[entry.stageId] ?? 0) + 1 },
    });
  };
  const log = (stageId, name, status, ms) => {
    cctx.log.info('coach', { stage: stageId, who: cctx.anon.code(name), status, ms });
  };
  const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

  cctx.on('coach:s-ask', askShape, async (socket, { kind, question, draft }, actor) => {
    const name = actor.name;
    const stageId = cctx.state.currentStage;
    const stage = stageOf(stageId);
    if (!stage || !coachOn(stage.config)) return cctx.reject(socket, MSG.notOpen);
    if (!isConfigured) return cctx.reject(socket, MSG.notConfigured);
    if (paused) return cctx.reject(socket, MSG.paused);

    const rec = recordOf(name);
    const asks = Array.isArray(rec.asks) ? rec.asks.filter(isPlainObject) : [];
    const here = asks.filter((a) => a.stageId === stageId);
    const okCount = here.filter((a) => a.status === 'ok').length;
    const level = Math.min(MAX_LEVEL, okCount + 1);
    // §12.1 follow：本段要先有一条 ok 回答，且 question ≥ 4 字
    if (kind === 'follow' && (okCount === 0 || Array.from(clean(question).trim()).length < FOLLOW_MIN)) {
      return cctx.reject(socket, MSG.followFirst);
    }
    // C6 check：本段要有要求清单、本段记录要有代码（最终稿或最近运行）
    if (kind === 'check') {
      if (requirementsOf(optionsOf(stage)).length === 0) return cctx.reject(socket, MSG.checkNoList);
      if (!codeOf(cctx.stages.data(stageId).get(name))) return cctx.reject(socket, MSG.checkNoCode);
    }

    const used = rec.byStage?.[stageId] ?? 0;
    if (used >= maxPerStage) {
      append(name, { id: newId(), stageId, at: Date.now(), kind, level, q: question, a: '', status: 'limited', ms: 0 });
      log(stageId, name, 'limited', 0);
      return cctx.reject(socket, MSG.limited);
    }
    // §12.3 渐进冷却：本段 refused ≥ 3 → 距最近一次被拒 cooldownMs + refusedCooldownMs
    const refused = here.filter((a) => a.status === 'refused');
    if (refused.length >= REFUSED_STREAK && refusedCooldownMs > 0) {
      const left = refused[refused.length - 1].at + cooldownMs + refusedCooldownMs - Date.now();
      if (left > 0) return cctx.reject(socket, MSG.refusedCooldown(Math.ceil(left / 1000)));
    }
    const last = [...asks].reverse().find((a) => a.status !== 'limited');
    if (last && cooldownMs > 0) {
      const left = last.at + cooldownMs - Date.now();
      if (left > 0) return cctx.reject(socket, MSG.cooldown(Math.ceil(left / 1000)));
    }
    if (inflight.has(name)) return cctx.reject(socket, MSG.busy);

    // §12.3 输入规则：命中不调模型，落一条 refused（计次）
    //   C6：check 的问题可空，空时不检测
    const skipScreen = kind === 'check' && clean(question).trim() === '';
    const { hit } = skipScreen ? { hit: null } : screen(question, here.slice(-RECENT_COUNT).map((a) => a.q));
    if (hit) {
      append(name, { id: newId(), stageId, at: Date.now(), kind, level, q: question, a: REPLY[hit], status: 'refused', ms: 0 });
      log(stageId, name, 'refused', 0);
      return undefined;
    }

    inflight.add(name);
    const gen = generation;
    const at = Date.now();
    // C4：本段记录（progress 与 err 用）；ask 记录存提问时的报错首行
    const record = cctx.stages.data(stageId).get(name);
    const errHead = errorHead(record?.error);
    try {
      let status = 'failed';
      let answer = '';
      let ms = 0;
      const options = optionsOf(stage);
      const previous = asks
        .filter((a) => a && a.stageId === stageId && a.status === 'ok')
        .map((a) => ({ q: a.q, a: a.a, ...(typeof a.err === 'string' && a.err ? { err: a.err } : {}) }));
      const user = userFor({ name, stage, record, draft, question, previous, kind, level, now: at });
      const started = Date.now();
      let route = null;
      try {
        const r = await ai.chat(
          [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
          { caller: 'coach', timeoutMs: testHooks.timeoutMs ?? COACH_TIMEOUT_MS },
        );
        ms = r.ms;
        route = r.route ?? null;
        refreshNotice(route);
        answer = sanitize(r.content, typeof options.solution === 'string' ? options.solution : '', { level, kind });
        if (answer) status = 'ok';
      } catch (err) {
        // 内核排队满（AIError('crowded')）：不落库、不扣次数（学生过一会再问即可）；日志记 crowded
        if (err?.reason === 'crowded') {
          if (gen !== generation) return undefined;
          log(stageId, name, 'crowded', 0);
          return cctx.reject(socket, MSG.crowded);
        }
        ms = Date.now() - started;
        refreshNotice(null);
      }
      if (gen !== generation) return undefined;   // 等候 / 请求期间课堂被重置
      append(name, {
        id: newId(), stageId, at, kind, level, q: question, a: status === 'ok' ? answer : '', status, ms,
        ...(errHead ? { err: errHead } : {}),
        ...(status === 'ok' && route === 2 ? { route: 2 } : {}),
      });
      log(stageId, name, status, ms);
      return undefined;
    } finally {
      if (gen === generation) inflight.delete(name);
    }
  });

  // §12.6 教师暂停 / 恢复（t- 事件：内核分发只放行教师 socket）
  cctx.on('coach:t-pause', pauseShape, (socket, { paused: next }) => {
    if (next === paused) return;
    paused = next;
    publish();
  });

  // ---------- C6：教师"AI 帮我看一遍"（coach:t-review） ----------
  // reviews: stageId → { stageId, status, at, total, done, failed, items, perStudent, timer, lastEmit }；
  //   在途的结果回来时 reviews.get(stageId) 已不是它（重置 / 再次 start）或 status 不是 running（stop）→ 丢弃
  let reviews = new Map();
  const idleView = (stageId) => ({
    stageId, status: 'idle', at: null, total: 0, done: 0, failed: 0,
    count: requirementsOf(optionsOf(stageOf(stageId))).length, perStudent: {}, summary: [],
  });
  const viewOf = (r) => ({
    stageId: r.stageId, status: r.status, at: r.at, total: r.total, done: r.done, failed: r.failed,
    count: r.items.length, perStudent: r.perStudent, summary: summarize(r.perStudent, r.items),
    ...(r.truncated ? { truncated: true } : {}),
  });
  // C7：持久化（教师专属存储）。只存当前这一次（reviews 里的那个）；超限按 fitStored 缩，缩不下 / key 不合法只记日志
  const td = cctx.teacherData ?? null;
  const storedOf = (r) => ({
    status: r.status, startedAt: r.at, finishedAt: r.finishedAt ?? null, total: r.total, done: r.done, failed: r.failed,
    summary: summarize(r.perStudent, r.items),
    perStudent: Object.fromEntries(Object.entries(r.perStudent).map(([name, s]) => [name, { status: s.status, rows: s.rows }])),
  });
  const persist = (r) => {
    if (!td || reviews.get(r.stageId) !== r) return;
    try {
      const fit = fitStored(storedOf(r));
      if (!fit) {
        cctx.log.warn('coach-review', { stage: r.stageId, error: 'too large to store' });
        return;
      }
      td.set(REVIEW_KEY + r.stageId, fit);
    } catch (err) {
      cctx.log.warn('coach-review', { stage: r.stageId, error: String(err?.message ?? err) });
    }
  };
  // 启动时载入：段还在、形状对的才载入；running（上次进程在核对中退出）→ stopped 并写回
  for (const key of td?.keys() ?? []) {
    if (!key.startsWith(REVIEW_KEY)) continue;
    const stageId = key.slice(REVIEW_KEY.length);
    const stage = stageOf(stageId);
    let s;
    try {
      s = td.get(key);
    } catch {
      continue;
    }
    if (!stage || !isPlainObject(s) || !REVIEW_STATUSES.has(s.status) || !isPlainObject(s.perStudent)) continue;
    const perStudent = {};
    for (const [name, p] of Object.entries(s.perStudent)) {
      if (!isPlainObject(p)) continue;
      perStudent[name] = { status: p.status === 'ok' ? 'ok' : 'failed', rows: Array.isArray(p.rows) ? p.rows.filter(isPlainObject) : [], rest: '' };
    }
    const wasRunning = s.status === 'running';
    const r = {
      stageId, status: wasRunning ? 'stopped' : s.status, at: Number.isFinite(s.startedAt) ? s.startedAt : null,
      finishedAt: Number.isFinite(s.finishedAt) ? s.finishedAt : (wasRunning ? Date.now() : null),
      total: nonNegInt(s.total, 0), done: nonNegInt(s.done, 0), failed: nonNegInt(s.failed, 0),
      items: requirementsOf(optionsOf(stage)), perStudent, timer: null, lastEmit: 0, truncated: s.truncated === true,
    };
    reviews.set(stageId, r);
    if (wasRunning) persist(r);
  }
  const clearTimer = (r) => {
    if (r?.timer) clearTimeout(r.timer);
    if (r) r.timer = null;
  };
  // 发给全体教师；force 立即发（开始、结束、停止），否则按节流合并（窗口外立即发，窗口内的最后一次在窗口末发）
  const emitReview = (r, force = false) => {
    const send = () => {
      clearTimer(r);
      if (reviews.get(r.stageId) !== r) return;
      r.lastEmit = Date.now();
      cctx.emitTeachers(REVIEW_EVENT, viewOf(r));
    };
    const ms = hookOr(testHooks.reviewThrottleMs, REVIEW_THROTTLE_MS);
    if (force || ms === 0) return send();
    const wait = r.lastEmit + ms - Date.now();
    if (wait <= 0) return send();
    if (!r.timer) {
      r.timer = setTimeout(send, wait);
      r.timer.unref?.();
    }
    return undefined;
  };
  // 当前段或已过的段（stages.list() 第 i 项对应 stageIndex i + 1；prelogin 为 0、curtain 为末尾）
  const stageReached = (stageId) => {
    const i = cctx.stages.list().findIndex((s) => s.id === stageId);
    return i >= 0 && i + 1 <= cctx.state.stageIndex;
  };
  const sleep = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

  // 组件级名额（审查 1）：所有段、所有次 review 共用，同时在途的 ai.chat ≤ REVIEW_CONCURRENCY。
  //   名额在请求回来后才还（覆盖 / 停止 / 重置都不取消已发出的请求，新 review 只能用剩下的名额）；排队先来先得
  let slotsUsed = 0;
  const slotWaiters = [];
  const acquire = () => new Promise((resolve) => {
    if (slotsUsed < REVIEW_CONCURRENCY) {
      slotsUsed++;
      resolve();
    } else slotWaiters.push(resolve);
  });
  const releaseSlot = () => {
    const next = slotWaiters.shift();
    if (next) next();   // 名额直接转给排队的
    else slotsUsed--;
  };

  const FAILED = Object.freeze({ status: 'failed', rows: [], rest: '' });
  const failedOut = () => ({ ...FAILED, rows: [] });
  // 一名学生：同 check（question 空、previous 空，level 1），crowded 等一会重试一次；失败 / 只剩占位句 → failed；已作废 → null
  //   调用方已拿到名额；这里只管请求本身
  const reviewOne = async (r, name, stage, record) => {
    const failed = failedOut();
    const alive = () => reviews.get(r.stageId) === r && r.status === 'running';
    const options = optionsOf(stage);
    const user = userFor({
      name, stage, record: reviewRecord(record), question: '', previous: [], kind: 'check', level: 1, now: Date.now(),
    });
    const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
    const call = () => ai.chat(messages, { caller: 'coach-review', timeoutMs: testHooks.timeoutMs ?? COACH_TIMEOUT_MS });
    const started = Date.now();
    const log1 = (status, ms) => cctx.log.info('coach-review', { stage: r.stageId, who: cctx.anon.code(name), status, ms });
    let res;
    try {
      try {
        res = await call();
      } catch (err) {
        if (err?.reason !== 'crowded') throw err;
        await sleep(hookOr(testHooks.reviewRetryMs, REVIEW_RETRY_MS));
        if (!alive()) return null;
        res = await call();
      }
    } catch (err) {
      if (!alive()) return null;
      if (err?.reason !== 'crowded') refreshNotice(null);
      log1(err?.reason === 'crowded' ? 'crowded' : 'failed', Date.now() - started);
      return failed;
    }
    if (!alive()) return null;
    refreshNotice(res.route ?? null);
    const answer = sanitize(res.content, typeof options.solution === 'string' ? options.solution : '', { level: 1, kind: 'check' });
    log1(answer ? 'ok' : 'failed', res.ms);
    if (!answer) return failed;
    // C7：每生每条存 { n, verdict, reason ≤ 200 }（教师侧栏点名字看理由）
    const { rows, rest } = parseVerdicts(answer, r.items.length);
    return { status: 'ok', rows: reviewRows(rows), rest };
  };

  const startReview = (stage, items) => {
    clearTimer(reviews.get(stage.id));
    const records = { ...(cctx.stages.data(stage.id).all() ?? {}) };
    const names = Object.keys(records).filter((n) => codeOf(records[n]) !== '').sort((a, b) => a.localeCompare(b, 'zh'));
    const r = {
      stageId: stage.id, status: names.length > 0 ? 'running' : 'done', at: Date.now(), total: names.length, done: 0, failed: 0,
      items, perStudent: {}, timer: null, lastEmit: 0, finishedAt: names.length > 0 ? null : Date.now(),
    };
    reviews.set(stage.id, r);
    emitReview(r, true);
    persist(r);
    let next = 0;
    const alive = () => reviews.get(r.stageId) === r && r.status === 'running';
    const worker = async () => {
      while (alive() && next < names.length) {
        await acquire();
        if (!alive() || next >= names.length) {
          releaseSlot();
          return;
        }
        const name = names[next++];
        let out;
        try {
          out = await reviewOne(r, name, stage, records[name]);
        } catch (err) {
          // 审查 3：非 AI 的意外错误也记该生 failed，不让 review 卡在 running
          cctx.log.warn('coach-review', { stage: r.stageId, who: cctx.anon.code(name), error: String(err?.message ?? err) });
          out = alive() ? failedOut() : null;
        } finally {
          releaseSlot();
        }
        if (out === null || !alive()) return;
        r.perStudent[name] = out;
        r.done++;
        if (out.status === 'failed') r.failed++;
        if (r.done >= r.total) {
          r.status = 'done';
          r.finishedAt = Date.now();
          emitReview(r, true);
        } else emitReview(r);
        persist(r);
      }
    };
    for (let i = 0; i < REVIEW_CONCURRENCY; i++) {
      worker().catch((err) => cctx.log.warn('coach-review', { stage: r.stageId, error: String(err?.message ?? err) }));
    }
  };

  // t- 事件：内核分发只放行教师 socket
  cctx.on('coach:t-review', reviewShape, (socket, { stageId, action }) => {
    if (action === 'stop') {
      if (!stageOf(stageId)) return cctx.reject(socket, MSG.reviewNoStage);
      const r = reviews.get(stageId);
      if (r && r.status === 'running') {
        r.status = 'stopped';
        r.finishedAt = Date.now();
        emitReview(r, true);
        persist(r);
      }
      return undefined;
    }
    const stage = stageOf(stageId);
    if (!stage || !stageReached(stageId)) return cctx.reject(socket, MSG.reviewNotReached);
    const items = requirementsOf(optionsOf(stage));
    if (items.length === 0) return cctx.reject(socket, MSG.reviewNoList);
    if (!isConfigured) return cctx.reject(socket, MSG.notConfigured);
    startReview(stage, items);
    return undefined;
  });

  cctx.on('coach:t-review-get', reviewGetShape, (socket, { stageId }) => {
    const r = reviews.get(stageId);
    cctx.emitToSocket(socket, REVIEW_EVENT, r ? viewOf(r) : idleView(stageId));
  });

  cctx.hooks.onReset(() => {
    generation++;
    paused = false;
    inflight = new Set();
    publish();
    // C6：清空全部 review，对看过的段各发一次 idle（C7：存储由内核在调钩子前清表，这里不动）
    const old = reviews;
    reviews = new Map();
    for (const [stageId, r] of old) {
      clearTimer(r);
      cctx.emitTeachers(REVIEW_EVENT, idleView(stageId));
    }
  });
}
