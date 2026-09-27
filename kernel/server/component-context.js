// 组件上下文与组件分发器（规格 v0.5 §2.2）
// createComponentContext({ id, options, io, state, db, log?, throttle?, stages?, anon?, actions?, ai? }) → cctx
//   K6：cctx.ai 为内核统一 AI 接口（kernel/server/ai.js，缺省未配置实例），与阶段 ctx.ai 同一实例
//   data 复用阶段的数据句柄（stageId = component:<id>），写入后内核照常发 stage:data-update / stage:my-data / stage:class-update
//   anon 缺省为 state.anon（推进与重置时由 state 清空）；actions 缺省写 teacher_actions（stage_id = 当前阶段）
// createComponentDispatcher({ contexts, log? }) → { handle(socket, event, payload), attach(socket), events() }
//   按事件名第一段路由到组件；不受"仅当前阶段"限制；顺序：角色 → schema → handler；未注册事件静默
// runComponentHooks(contexts, 'stageChange' | 'reset', arg, log) → 依次调用已注册钩子（异常只记日志）
import { AsyncLocalStorage } from 'node:async_hooks';
import { createLog } from './log.js';
import { createDataHandle } from './stage-context.js';
import { unconfiguredAI } from './ai.js';

export const COMPONENT_HANDLERS = Symbol('componentHandlers');
export const COMPONENT_HOOKS = Symbol('componentHooks');

export const componentStageId = (id) => `component:${id}`;

const dispatchStore = new AsyncLocalStorage();

export function createComponentContext({ id, options, io, state, db, log, throttle, stages, anon, actions, ai }) {
  const onRe = new RegExp(`^${id}:(t|s)-[a-z-]+$`);
  const emitRe = new RegExp(`^${id}:[a-z-]+$`);
  const handlers = new Map();
  const hooks = { stageChange: [], reset: [] };
  const stageId = componentStageId(id);
  const lessonStages = stages ?? state.lessonStages ?? [];

  const checkEmit = (event) => {
    if (typeof event !== 'string' || !emitRe.test(event) || /^[^:]+:(t|s)-/.test(event)) {
      throw new Error(`component "${id}": emit event must match ^${id}:[a-z-]+$ without t-/s- segment, got ${JSON.stringify(event)}`);
    }
  };
  const socketIdOf = (name) => {
    const s = state.getStudent(name);
    return s && s.connected && s.socketId ? s.socketId : null;
  };
  const project = (s) => ({
    name: s.name,
    connected: !!s.connected,
    enteredStageAt: s.enteredStageAt ?? null,
    enteredStageIndex: s.enteredStageIndex ?? null,
  });
  const readOnlyData = (sid) => ({
    get: (name) => state.data.get(sid, name),
    all: () => state.data.all(sid),
    getClass: () => state.data.getClass(sid),
  });
  const pushHook = (list, fn) => {
    if (typeof fn !== 'function') throw new Error(`component "${id}": hook must be a function`);
    list.push(fn);
  };

  const cctx = {
    id,
    options: options ?? {},
    log: log ?? createLog(stageId),

    on(event, schema, handler) {
      if (typeof event !== 'string' || !onRe.test(event)) {
        throw new Error(`component "${id}": invalid event name ${JSON.stringify(event)} (must match ${onRe})`);
      }
      if (typeof schema !== 'function') throw new Error(`component "${id}": on("${event}") requires a schema (use shape({}))`);
      if (typeof handler !== 'function') throw new Error(`component "${id}": on("${event}") handler must be a function`);
      if (handlers.has(event)) throw new Error(`component "${id}": event "${event}" already registered`);
      handlers.set(event, { schema, handler });
    },

    reject(socket, message) {
      const store = dispatchStore.getStore();
      if (store && store.rejected === undefined) store.rejected = String(message);
      socket.emit('error:validation', { event: store?.event ?? null, message: String(message) });
    },

    emitAll(event, payload) {
      checkEmit(event);
      io.emit(event, payload);
    },
    emitTeachers(event, payload) {
      checkEmit(event);
      io.to('teacher').emit(event, payload);
    },
    emitStudents(event, payload) {
      checkEmit(event);
      io.except('teacher').emit(event, payload);
    },
    emitToStudent(name, event, payload) {
      checkEmit(event);
      const sid = socketIdOf(name);
      if (sid) io.to(sid).emit(event, payload);
    },
    emitToSocket(socket, event, payload) {
      checkEmit(event);
      socket.emit(event, payload);
    },

    state: {
      get currentStage() {
        return state.currentStage;
      },
      get stageIndex() {
        return state.currentIndex;
      },
      get subPhase() {
        return state.subPhase;
      },
      students: () => state.students(),
      connected: () => state.connected(),
      student(name) {
        const s = state.getStudent(name);
        return s ? project(s) : undefined;
      },
    },

    stages: {
      list: () => lessonStages.map((s) => ({ id: s.id, label: s.config?.label, config: s.config, dir: s.dir })),   // K5：dir = 阶段目录绝对路径
      data: (sid) => readOnlyData(sid),
    },

    data: createDataHandle({ io, state, db, stageId, throttle }),

    actions: actions ?? {
      append(type, payload) {
        if (typeof type !== 'string' || !type) throw new Error('actions.append: type must be a non-empty string');
        if (db) db.appendTeacherAction(type, state.currentStage, payload ?? null, state.classEpoch);
      },
    },

    anon: { code: (name) => (anon ?? state.anon).code(name) },

    ai: ai ?? unconfiguredAI(),

    hooks: {
      onStageChange: (fn) => pushHook(hooks.stageChange, fn),
      onReset: (fn) => pushHook(hooks.reset, fn),
    },
  };
  Object.defineProperty(cctx, COMPONENT_HANDLERS, { value: handlers, enumerable: false });
  Object.defineProperty(cctx, COMPONENT_HOOKS, { value: hooks, enumerable: false });
  return cctx;
}

// 钩子：stageChange(fn({ from, to }))、reset(fn())；按组件顺序、注册顺序依次调用，异常只记日志
export function runComponentHooks(contexts, name, arg, log = createLog('component')) {
  for (const cctx of contexts.values()) {
    for (const fn of cctx[COMPONENT_HOOKS][name]) {
      try {
        const r = name === 'reset' ? fn() : fn(arg);
        if (r && typeof r.catch === 'function') {
          r.catch((err) => log.error(`component "${cctx.id}" ${name} hook failed: ${err?.message ?? err}`));
        }
      } catch (err) {
        log.error(`component "${cctx.id}" ${name} hook failed: ${err?.message ?? err}`);
      }
    }
  }
}

export function createComponentDispatcher({ contexts, log = createLog('component') }) {
  const entryOf = (event) => {
    if (typeof event !== 'string') return null;
    const cctx = contexts.get(event.split(':')[0]);
    return cctx ? cctx[COMPONENT_HANDLERS].get(event) ?? null : null;
  };

  function events() {
    const out = [];
    for (const c of contexts.values()) for (const ev of c[COMPONENT_HANDLERS].keys()) out.push(ev);
    return out;
  }

  async function handle(socket, event, payload) {
    const entry = entryOf(event);
    if (!entry) return { ok: false, ignored: true };
    const fail = (message) => {
      try {
        socket.emit('error:validation', { event, message });
      } catch {
        // socket 已断开
      }
      return { ok: false, error: message };
    };

    // 1. 角色：第二段 t- 教师、s- 学生
    const need = event.split(':')[1].startsWith('t-') ? 'teacher' : 'student';
    const role = socket.data?.role;
    if (role !== need || (need === 'student' && typeof socket.data?.name !== 'string')) return fail('forbidden');

    // 2. schema
    let data;
    try {
      data = entry.schema(payload);
    } catch (err) {
      return fail(err?.message ?? String(err));
    }

    // 3. handler（safeOn）
    const actor = need === 'student' ? { role: 'student', name: socket.data.name } : { role: 'teacher', name: null };
    const store = { event, rejected: undefined };
    try {
      await dispatchStore.run(store, () => entry.handler(socket, data, actor));
    } catch (err) {
      const msg = err?.message ?? String(err);
      log.warn(`${event} handler threw: ${msg}`);
      return fail(msg);
    }
    if (store.rejected !== undefined) return { ok: false, rejected: store.rejected };
    return { ok: true };
  }

  function attach(socket) {
    for (const ev of events()) {
      socket.on(ev, (payload) => {
        handle(socket, ev, payload).catch((err) => log.error(`dispatch ${ev} failed`, err?.message));
      });
    }
  }

  return { handle, attach, events };
}
