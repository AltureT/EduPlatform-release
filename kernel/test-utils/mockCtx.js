// 冻结接口（规格 §10）：mockCtx({ stageId, config, students, data, subPhase })
// 基于真实 stage-context.js + mockIo + memDb；与真实 ctx 同形，另加：
//   dispatch(event, actor, payload) → Promise<{ ok, rejected?, error? }>（角色 → schema → handler；当前阶段恒为本阶段）
//   emitted: [{ target: { kind: 'all'|'teachers'|'students'|'student'|'socket', name? }, event, payload }]
//     含阶段 emit 与内核自动发送（stage:data-update → teachers 不节流、stage:my-data → student、stage:class-update → all），
//     不含 error:validation
//   gate() → config.gate(ctx)（缺省视为 { ok: true }）
import { createState } from '#kernel/server/state.js';
import { createStageContext, createDispatcher } from '#kernel/server/stage-context.js';
import { mockIo } from './mockIo.js';
import { mockSocket } from './mockSocket.js';
import { memDb } from './memDb.js';

export function mockCtx({ stageId, config = {}, students = [], data = {}, subPhase } = {}) {
  if (typeof stageId !== 'string' || !stageId) throw new Error('mockCtx: stageId required');
  const state = createState({
    lesson: { id: 'mock', title: 'mock' },
    stages: [{ id: stageId, dir: '', hasDemo: false, config }],
  });
  state.currentIndex = 1; // prelogin=0，本阶段=1
  state.subPhase = subPhase !== undefined ? subPhase : (config.subPhases?.[0] ?? null);
  state.classEpoch = 'epoch-mock';

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
  for (const [name, record] of Object.entries(data.perStudent ?? {})) state.data.set(stageId, name, record);
  if (data.perClass && Object.keys(data.perClass).length > 0) state.data.setClass(stageId, data.perClass);

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

  const ctx = createStageContext({ io, state, db: memDb(), stageId, config, throttle });
  const dispatcher = createDispatcher({ io, state, contexts: [ctx] });

  async function dispatch(event, actor, payload) {
    const role = actor?.role;
    const socket = mockSocket(role, role === 'student' ? actor.name : null);
    const rawEmit = socket.emit;
    socket.emit = (ev, p) => {
      rawEmit(ev, p);
      record({ kind: 'socket' }, ev, p);
    };
    const r = await dispatcher.handle(socket, event, payload);
    // 裁决（已接受）：未注册事件返回 { ok:false, error }，便于阶段测试发现拼写错误
    if (r.ignored) return { ok: false, error: `event "${event}" not registered` };
    return r;
  }

  async function gate() {
    return config.gate ? config.gate(ctx) : { ok: true };
  }

  return Object.assign(ctx, { dispatch, emitted, gate });
}
