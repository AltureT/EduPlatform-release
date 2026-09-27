// 规格 v0.5 §2.7：mockCctx({ id, options, stages: [{ id, config, dir?, perStudent, perClass }], students, data: { perStudent, perClass }, currentStage, ai })
//   K6：ai 缺省为未配置实例（chat 抛 not-configured）；测试注入 createAI({ env, fetch }) 用假 fetch
// 基于真实 component-context.js + mockIo + memDb；与 cctx 同形，另加：
//   dispatch(event, actor, payload) → Promise<{ ok, rejected?, error? }>（角色 → schema → handler；不受当前阶段限制）
//   emitted: [{ target: { kind: 'all'|'teachers'|'students'|'student'|'socket', name? }, event, payload }]
//     含组件 emit 与内核自动发送（stage:data-update → teachers 不节流、stage:my-data → student、stage:class-update → all），
//     不含 error:validation
//   actions: [{ type, stageId, payload }]（actions.append 的记录；同时写入 memDb 的 teacher_actions）
//     规格里 cctx.actions 是 { append }、mockCctx.actions 是记录数组，两者同名：这里 actions 是数组，
//     并挂一个不可枚举的 append 方法，因此 cctx.actions.append(...) 照常可用，断言时按数组比较
//   fire('stageChange', { from, to }) / fire('reset')：触发已注册的 hooks
//   setCurrentStage(id)：切换当前阶段（prelogin / 课程阶段 / curtain）；阶段变化时与真实推进一样清空 anon
// currentStage 缺省为第一个课程阶段（无课程阶段时为 prelogin）；未注册事件 dispatch 返回 { ok:false, error }
import { createState } from '#kernel/server/state.js';
import { createComponentContext, createComponentDispatcher, COMPONENT_HOOKS } from '#kernel/server/component-context.js';
import { mockIo } from './mockIo.js';
import { mockSocket } from './mockSocket.js';
import { memDb } from './memDb.js';
import { unconfiguredAI } from '#kernel/server/ai.js';

const quietLog = { info() {}, warn() {}, error() {} };

export function mockCctx({ id, options = {}, stages = [], students = [], data = {}, currentStage, ai } = {}) {
  if (typeof id !== 'string' || !id) throw new Error('mockCctx: id required');
  const lessonStages = stages.map((s) => ({
    id: s.id,
    dir: s.dir ?? '',
    hasDemo: false,
    config: s.config ?? { id: s.id, label: s.id },
  }));
  const state = createState({
    lesson: { id: 'mock', title: 'mock' },
    stages: lessonStages,
    components: [{ id, label: id, options, dir: '' }],
  });
  state.classEpoch = 'epoch-mock';

  const indexOf = (stageId) => {
    const i = state.stageIds.indexOf(stageId);
    if (i < 0) throw new Error(`mockCctx: unknown stage "${stageId}"`);
    return i;
  };
  const applyStage = (stageId) => {
    state.currentIndex = indexOf(stageId);
    state.subPhase = state.stageConfig(stageId)?.subPhases?.[0] ?? null;
  };
  applyStage(currentStage ?? lessonStages[0]?.id ?? 'prelogin');

  const now = Date.now();
  for (const s of students) {
    state.studentMap.set(s.name, {
      name: s.name,
      socketId: `mock-student:${s.name}`,
      connected: s.connected !== false,
      joinedAt: now,
      lastSeen: now,
      deviceId: null,
      enteredStageAt: s.enteredStageAt ?? null,
      enteredStageIndex: s.enteredStageIndex ?? null,
    });
  }
  const seed = (stageId, perStudent, perClass) => {
    for (const [name, record] of Object.entries(perStudent ?? {})) state.data.set(stageId, name, record);
    if (perClass && Object.keys(perClass).length > 0) state.data.setClass(stageId, perClass);
  };
  for (const s of stages) seed(s.id, s.perStudent, s.perClass);
  seed(`component:${id}`, data.perStudent, data.perClass);

  const base = mockIo();
  const emitted = [];
  const nameBySocketId = (sid) => {
    for (const s of state.studentMap.values()) if (s.socketId === sid) return s.name;
    return undefined;
  };
  const record = (target, event, payload) => {
    if (event !== 'error:validation') emitted.push({ target, event, payload });
  };
  const io = {
    emit(event, payload) {
      base.emit(event, payload);
      record({ kind: 'all' }, event, payload);
    },
    to(room) {
      return {
        emit(event, payload) {
          base.to(room).emit(event, payload);
          record(room === 'teacher' ? { kind: 'teachers' } : { kind: 'student', name: nameBySocketId(room) }, event, payload);
        },
      };
    },
    except(room) {
      return {
        emit(event, payload) {
          base.except(room).emit(event, payload);
          record({ kind: 'students' }, event, payload);
        },
      };
    },
  };
  // 不节流：每次 data.set 立即记一条 stage:data-update → teachers
  const throttle = {
    push: (_key, payload) => io.to('teacher').emit('stage:data-update', payload),
    flushAll() {},
    dropAll() {},
  };

  const db = memDb();
  const actions = [];
  Object.defineProperty(actions, 'append', {
    enumerable: false,
    value(type, payload) {
      if (typeof type !== 'string' || !type) throw new Error('actions.append: type must be a non-empty string');
      actions.push({ type, stageId: state.currentStage, payload: payload ?? null });
      db.appendTeacherAction(type, state.currentStage, payload ?? null, state.classEpoch);
    },
  });
  const cctx = createComponentContext({
    id,
    options,
    io,
    state,
    db,
    log: quietLog,
    throttle,
    stages: lessonStages,
    actions,
    ai: ai ?? unconfiguredAI(quietLog),
  });
  const dispatcher = createComponentDispatcher({ contexts: new Map([[id, cctx]]), log: quietLog });

  async function dispatch(event, actor, payload) {
    const role = actor?.role;
    const socket = mockSocket(role, role === 'student' ? actor.name : null);
    const rawEmit = socket.emit;
    socket.emit = (ev, p) => {
      rawEmit(ev, p);
      record({ kind: 'socket' }, ev, p);
    };
    const r = await dispatcher.handle(socket, event, payload);
    if (r.ignored) return { ok: false, error: `event "${event}" not registered` };
    return r;
  }

  function fire(name, arg) {
    const hooks = cctx[COMPONENT_HOOKS];
    if (name === 'stageChange') {
      for (const fn of hooks.stageChange) fn(arg);
    } else if (name === 'reset') {
      for (const fn of hooks.reset) fn();
    } else {
      throw new Error(`mockCctx.fire: unknown hook "${name}" (stageChange | reset)`);
    }
  }

  function setCurrentStage(stageId) {
    const prev = state.currentIndex;
    applyStage(stageId);
    if (state.currentIndex !== prev) state.anon.clear();
  }

  return Object.assign(cctx, { dispatch, emitted, fire, setCurrentStage });
}
