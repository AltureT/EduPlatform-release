// coach 组件服务端（coach 组件规格 §2、§4、§12）
// 数据（stageId component:coach）：perClass = { enabled, reason: null | '未配置', paused: boolean }；
//   perStudent[name] = { asks: [{ id, stageId, at, kind, level, q, a, status: 'ok'|'failed'|'limited'|'refused', ms }]（最近 50 条）,
//                        byStage: { [stageId]: 次数 } }
// §12：coach:s-ask 带 kind（understand | think | debug | follow）；level = min(3, 本段 ok 次数 + 1)；
//   输入规则（guard.screen）命中 → 不调模型，落一条 refused（a 为固定回复）并计次；本段 refused ≥ 3 → 额外冷却 refusedCooldownMs；
//   coach:t-pause { paused }：教师暂停 / 恢复（t- 前缀由内核分发按角色放行，只有教师 socket 能发）；重置清掉暂停
// 隐私：发给模型的内容不含学生姓名；日志只记阶段、匿名代号、状态、耗时
// K6：调模型走内核统一接口 cctx.ai.chat(messages, { caller: 'coach' })（统一 AI 接口规格 §3）；
//   地址 / 模型 / 密钥、超时、全局并发（在途 8、排队 20，超出抛 AIError('crowded')）都由内核管；
//   perClass.enabled / reason 取自 cctx.ai.configured / reason
// 测试注入：导出的 testHooks.ai（createAI({ env, fetch })），register 时非 null 的优先；不走组件 options
//   （组件 options 会随 classroom:state 下发到客户端，课程配置里写 env 会泄露密钥）
import { shape } from '#kernel/server/schema.js';
import { SYSTEM, KINDS, MAX_LEVEL, buildUser, sanitize } from './prompt.js';
import { screen, clean, REPLY, RECENT_COUNT } from './guard.js';

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
  cooldown: (n) => `刚问过，等 ${n} 秒再问`,
  refusedCooldown: (n) => `刚被拒过几次，等 ${n} 秒再问`,
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonNegInt = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);

// 阶段 stage.config.js 顶层 coach：true | false | { intro }；对象视为开
export const coachOn = (config) => config?.coach === true || isPlainObject(config?.coach);

export const askShape = shape({
  kind: `enum:${KINDS.join(',')}`,
  question: 'string:0-500',
  draft: 'optional:string:0-20000',
});
export const pauseShape = shape({ paused: 'boolean' });

// 只供测试：register 之前赋值，测试结束后置回 null
export const testHooks = { ai: null };

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

  const publish = () => cctx.data.setClass({ enabled: isConfigured, reason, paused });
  publish();

  const stageOf = (id) => cctx.stages.list().find((s) => s.id === id) ?? null;
  const recordOf = (name) => cctx.data.get(name) ?? {};

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
    const { hit } = screen(question, here.slice(-RECENT_COUNT).map((a) => a.q));
    if (hit) {
      append(name, { id: newId(), stageId, at: Date.now(), kind, level, q: question, a: REPLY[hit], status: 'refused', ms: 0 });
      log(stageId, name, 'refused', 0);
      return undefined;
    }

    inflight.add(name);
    const gen = generation;
    const at = Date.now();
    try {
      let status = 'failed';
      let answer = '';
      let ms = 0;
      const options = isPlainObject(stage.config?.options) ? stage.config.options : {};
      const previous = asks
        .filter((a) => a && a.stageId === stageId && a.status === 'ok')
        .map((a) => ({ q: a.q, a: a.a }));
      const user = buildUser({
        stage, options, record: cctx.stages.data(stageId).get(name), draft, question, previous, ask: { kind, level },
      });
      const started = Date.now();
      try {
        const r = await ai.chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], { caller: 'coach' });
        ms = r.ms;
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
      }
      if (gen !== generation) return undefined;   // 等候 / 请求期间课堂被重置
      append(name, { id: newId(), stageId, at, kind, level, q: question, a: status === 'ok' ? answer : '', status, ms });
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

  cctx.hooks.onReset(() => {
    generation++;
    paused = false;
    inflight = new Set();
    publish();
  });
}
