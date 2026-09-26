// 阶段上下文（规格 §6、契约 §三）
// createStageContext({ io, state, db, stageId, config, log?, throttle? }) → ctx（register / gate / 钩子共用同一对象）
// createDispatcher({ io, state, contexts }) → { handle(socket, event, payload), attach(socket), events() }
// createDataHandle({ io, state, db, stageId, throttle }) → ctx.data（v0.5：组件上下文复用，stageId = component:<id>）
import { AsyncLocalStorage } from 'node:async_hooks';
import { createLog } from './log.js';
import { createThrottle } from './throttle.js';
import { saveSnapshot } from './persistence.js';

export const HANDLERS = Symbol('stageHandlers');

const EVENT_RE = /^(student|teacher):[a-z-]+$/;
// 契约 v0.5 §三：classroom:* / stage:* / student:* / teacher:* / error:* 由内核与阶段按现有规则使用；
// 组件前缀（内置组件固定 id）阶段不得使用
export const COMPONENT_EVENT_PREFIXES = ['share:', 'inbox:', 'report:', 'mirror:', 'coach:', 'sandbox:', 'web-sim:'];
const RESERVED_PREFIXES = [
  'classroom:', 'error:', 'student:join', 'student:request-claim-release', 'teacher:join', 'teacher:advance',
  'teacher:admin-', ...COMPONENT_EVENT_PREFIXES,
];
const RESERVED_EXACT = new Set([
  'stage:change', 'stage:sub-phase', 'stage:data-update', 'stage:class-update', 'stage:my-data',
  'student:joined', 'student:left', 'student:switch-name',
  'teacher:student-detail', 'teacher:get-student-detail', 'teacher:release-binding', 'teacher:reset-classroom',
  'teacher:import-roster', 'teacher:clear-roster',
]);

export function isReservedEvent(event) {
  return RESERVED_EXACT.has(event) || RESERVED_PREFIXES.some((p) => event.startsWith(p));
}

export function validateEventName(event) {
  if (typeof event !== 'string' || !EVENT_RE.test(event)) {
    throw new Error(`invalid event name ${JSON.stringify(event)} (must match ${EVENT_RE})`);
  }
  if (isReservedEvent(event)) throw new Error(`event "${event}" is reserved by the kernel`);
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 分发期上下文：当前事件名与 reject 记录（异步 handler 里也能取到）
const dispatchStore = new AsyncLocalStorage();

// 阶段 / 组件共用的数据句柄：data.set 后节流发 stage:data-update（教师）、单播 stage:my-data（本人）；
// setClass 后全员 stage:class-update
export function createDataHandle({ io, state, db, stageId, throttle }) {
  const tq =
    throttle ?? createThrottle({ windowMs: 100, send: (payload) => io.to('teacher').emit('stage:data-update', payload) });
  const socketIdOf = (name) => {
    const s = state.getStudent(name);
    return s && s.connected && s.socketId ? s.socketId : null;
  };
  return {
    get: (name) => state.data.get(stageId, name),
    set(name, patch) {
      if (typeof name !== 'string' || !name) throw new Error('data.set: name must be a non-empty string');
      if (!isPlainObject(patch)) throw new Error('data.set: patch must be an object');
      const record = { ...(state.data.get(stageId, name) ?? {}), ...patch, updatedAt: Date.now() };
      state.data.set(stageId, name, record);
      if (db) db.setStageStudentData(stageId, name, record);
      tq.push(`${stageId}\u0000${name}`, { stageId, name, data: record });
      const sid = socketIdOf(name);
      if (sid) io.to(sid).emit('stage:my-data', { stageId, data: record });
      return record;
    },
    all: () => state.data.all(stageId),
    getClass: () => state.data.getClass(stageId),
    setClass(patch) {
      if (!isPlainObject(patch)) throw new Error('data.setClass: patch must be an object');
      const record = { ...state.data.getClass(stageId), ...patch, updatedAt: Date.now() };
      state.data.setClass(stageId, record);
      if (db) db.setStageClassData(stageId, record);
      io.emit('stage:class-update', { stageId, data: record });
      return record;
    },
    appendEvent(name, type, payload) {
      if (typeof type !== 'string' || !type) throw new Error('data.appendEvent: type must be a non-empty string');
      if (db) db.appendStageEvent(stageId, name, type, payload ?? null, state.classEpoch);
    },
  };
}

export function createStageContext({ io, state, db, stageId, config, log, throttle }) {
  const handlers = new Map();
  const prefix = `stage:${stageId}:`;
  const stageLog = log ?? createLog(stageId);

  const checkEmit = (event) => {
    if (typeof event !== 'string' || !event.startsWith(prefix) || event.length === prefix.length) {
      throw new Error(`stage "${stageId}": emit event must start with "${prefix}", got ${JSON.stringify(event)}`);
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

  const ctx = {
    stageId,

    on(event, schema, handler) {
      validateEventName(event);
      if (typeof schema !== 'function') throw new Error(`stage "${stageId}": on("${event}") requires a schema (use shape({}))`);
      if (typeof handler !== 'function') throw new Error(`stage "${stageId}": on("${event}") handler must be a function`);
      if (handlers.has(event)) throw new Error(`stage "${stageId}": event "${event}" already registered`);
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

    setSubPhase(x) {
      // 裁决（已接受）：本阶段不是当前阶段时抛错，避免迟到的异步回调改写新阶段的 subPhase
      if (state.currentStage !== stageId) throw new Error(`stage "${stageId}" inactive: cannot set subPhase`);
      state.setSubPhase(x);
      if (db) saveSnapshot(state, db);
      io.emit('stage:sub-phase', { stage: stageId, subPhase: state.subPhase });
    },

    data: createDataHandle({ io, state, db, stageId, throttle }),

    log: stageLog,
  };
  Object.defineProperty(ctx, HANDLERS, { value: handlers, enumerable: false });
  Object.defineProperty(ctx, 'config', { value: config, enumerable: false });
  return ctx;
}

export function createDispatcher({ io, state, contexts, log = createLog('dispatch') }) {
  const list = contexts instanceof Map ? () => Array.from(contexts.values()) : () => Array.from(contexts);
  const byStage = (id) => list().find((c) => c.stageId === id);

  // 所有阶段注册过的事件名（运行期查表，便于注册在 dispatcher 创建之后进行）
  function events() {
    const set = new Set();
    for (const c of list()) for (const ev of c[HANDLERS].keys()) set.add(ev);
    return Array.from(set);
  }

  async function handle(socket, event, payload) {
    if (!list().some((c) => c[HANDLERS].has(event))) return { ok: false, ignored: true };
    const fail = (message) => {
      try {
        socket.emit('error:validation', { event, message });
      } catch {
        // socket 已断开
      }
      return { ok: false, error: message };
    };

    // 1. 角色
    const need = event.startsWith('student:') ? 'student' : 'teacher';
    const role = socket.data?.role;
    if (role !== need || (need === 'student' && typeof socket.data?.name !== 'string')) return fail('forbidden');

    // 2. 当前阶段
    const ctx = byStage(state.currentStage);
    const entry = ctx?.[HANDLERS].get(event);
    if (!entry) return fail('stage inactive');

    // 3. schema
    let data;
    try {
      data = entry.schema(payload);
    } catch (err) {
      return fail(err?.message ?? String(err));
    }

    // 4. handler（safeOn）
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
