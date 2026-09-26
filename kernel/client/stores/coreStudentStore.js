// 学生端核心 store（规格 §9.1；载荷按规格 §5 / §5.2 / §6.1）
//
// 重连与 hydrated（按规格 §9.1 实现）：
// - socket 'connect'（首次或重连）且本地有 name 时，置 hydrated=false 并用 name / deviceId / classEpoch
//   重发 student:join；收到 student:join-ok 前 hydrated=false，外壳不渲染阶段视图。
// - 断线期间（disconnect 到下次 connect 之间）不改 hydrated，阶段视图保持挂载，外壳只显示"重连中"，
//   避免网络抖动时丢失视图本地状态；断线期间视图发不出事件，不会与服务端不一致。
// - join-ok 回灌 state / myStageData / classData，重连后的数据以服务端为准。
import { create } from 'zustand';
import { socket } from '../socket.js';
import { getDeviceId } from '../deviceId.js';
import { runKernelHooks } from './kernelHooks.js';
import { bindStageSlices, resetSlices } from './stageStores.js';
import { bindComponentSlices, resetComponentSlices } from './componentRegistry.js';
import { mapPublicState, EMPTY_LESSON, EMPTY_COUNTS } from './publicState.js';

const NAME_KEY = 'student_name';
const EPOCH_KEY = 'class_epoch';
const DEFAULT_RESET_NOTICE = '课堂已重置，请重新登录';

// classroom:reset { reason, message? } → 登录页提示；null 表示不显示
export function resetNoticeFor(payload = {}) {
  switch (payload.reason) {
    case 'stale-session': return '课堂已重新开始，请重新登录';
    case 'teacher-reset': return '教师已重置课堂，请重新登录';
    case 'switch-name': return null;
    case 'bindings-cleared': return payload.message || DEFAULT_RESET_NOTICE;
    default: return payload.message || DEFAULT_RESET_NOTICE;
  }
}

function safeRead(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function safeWrite(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* 存储不可用 */ }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch (_) { /* 存储不可用 */ }
}
function readEpoch() {
  return safeRead(EPOCH_KEY) || null;
}
function persistEpoch(epoch) {
  if (typeof epoch === 'string' && epoch) safeWrite(EPOCH_KEY, epoch);
}
function joinPayload(name) {
  return { name, deviceId: getDeviceId(), classEpoch: readEpoch() };
}

const EMPTY_ME = { name: null, enteredStageAt: null, enteredStageIndex: null };

function meFrom(student, fallbackName) {
  return {
    name: (student && student.name) || fallbackName || null,
    enteredStageAt: student && student.enteredStageAt != null ? student.enteredStageAt : null,
    enteredStageIndex: student && student.enteredStageIndex != null ? student.enteredStageIndex : null,
  };
}

function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

const savedName = safeRead(NAME_KEY);
const savedEpoch = safeRead(EPOCH_KEY);

let listenersBound = false;

export const coreStudentStore = create((set, get) => ({
  name: savedName || null,
  joined: !!savedName,
  hydrated: false,
  stage: 'prelogin',
  stageIndex: 0,
  subPhase: null,
  viewedStageIndex: 0,
  connected: false,
  classEpoch: savedEpoch || null,
  resetNotice: null,
  roster: [],
  counts: { ...EMPTY_COUNTS },
  rosterMode: false,
  rosterNames: [],
  claimedNames: [],
  stages: [],
  components: [],
  lesson: EMPTY_LESSON,
  validationError: null,
  me: { ...EMPTY_ME, name: savedName || null },
  myStageData: {},
  classData: {},

  connect() {
    bindStageSlices(socket);
    bindComponentSlices(socket);
    if (!listenersBound) {
      listenersBound = true;
      bindListeners(set, get);
    }
    if (!socket.connected) {
      socket.connect();
    } else if (get().name) {
      set({ hydrated: false });
      socket.emit('student:join', joinPayload(get().name));
    }
    set({ connected: !!socket.connected });
  },

  // 一次性 promise：join-ok / join-error / classroom:reset（如 stale-session）任一到达即 resolve，
  // 并成对移除本次注册的全部 once 监听
  join(name) {
    return new Promise((resolve) => {
      const cleanup = () => {
        socket.off('student:join-ok', onOk);
        socket.off('student:join-error', onErr);
        socket.off('classroom:reset', onReset);
      };
      const onOk = (data = {}) => {
        cleanup();
        const finalName = (data.student && data.student.name) || name;
        resolve({ ok: true, renamed: data.renamed, finalName });
      };
      const onErr = (data = {}) => {
        cleanup();
        const r = { ok: false, error: data.message || '加入失败' };
        // 服务端在"本设备已绑定别的名字"时附带 boundName，登录页据此自动改名进入
        if (typeof data.boundName === 'string' && data.boundName) r.boundName = data.boundName;
        resolve(r);
      };
      const onReset = (data = {}) => {
        cleanup();
        resolve({ ok: false, error: data.message || resetNoticeFor(data) || DEFAULT_RESET_NOTICE });
      };
      socket.once('student:join-ok', onOk);
      socket.once('student:join-error', onErr);
      socket.once('classroom:reset', onReset);
      socket.emit('student:join', joinPayload(name));
    });
  },

  switchName(opts) {
    socket.emit('student:switch-name', opts && typeof opts === 'object' && !('nativeEvent' in opts) ? opts : {});
  },

  requestClaimRelease(name) {
    return new Promise((resolve) => {
      const cleanup = () => {
        socket.off('student:request-claim-release-ok', onOk);
        socket.off('student:request-claim-release-error', onErr);
      };
      const onOk = (data = {}) => {
        if (data.name !== name) return;
        cleanup();
        resolve({ ok: true });
      };
      const onErr = (data = {}) => {
        cleanup();
        resolve({ ok: false, error: data.message || '释放失败' });
      };
      socket.on('student:request-claim-release-ok', onOk);
      socket.on('student:request-claim-release-error', onErr);
      socket.emit('student:request-claim-release', { name });
    });
  },

  setViewedStageIndex(idx) {
    const { stageIndex } = get();
    if (!Number.isInteger(idx) || idx < 0 || idx > stageIndex) return;
    set({ viewedStageIndex: idx });
  },
}));

function bindListeners(set, get) {
  socket.on('connect', () => {
    set({ connected: true });
    const n = get().name;
    if (n) {
      set({ hydrated: false });
      socket.emit('student:join', joinPayload(n));
    }
  });
  socket.on('disconnect', () => set({ connected: false }));

  // join-ok 自带回灌（规格 §5.2 第 8 步）：state + myStageData + classData，整体替换
  socket.on('student:join-ok', (data = {}) => {
    const s = get();
    const finalName = (data.student && data.student.name) || s.name;
    if (finalName) safeWrite(NAME_KEY, finalName);
    persistEpoch(data.classEpoch);
    if (data.state && data.state.classEpoch) persistEpoch(data.state.classEpoch);
    set({
      ...mapPublicState(data.state, s),
      name: finalName,
      joined: true,
      hydrated: true,
      resetNotice: null,
      classEpoch: data.classEpoch || (data.state && data.state.classEpoch) || s.classEpoch || null,
      me: meFrom(data.student, finalName),
      myStageData: plainObject(data.myStageData),
      classData: plainObject(data.classData),
    });
  });

  socket.on('student:join-error', () => {
    safeRemove(NAME_KEY);
    set({ name: null, joined: false, hydrated: false, me: { ...EMPTY_ME } });
  });

  socket.on('classroom:state', (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.classEpoch) persistEpoch(data.classEpoch);
    set((s) => mapPublicState(data, s));
  });

  socket.on('stage:change', (payload = {}) => {
    const { stage, stageIndex, enteredStageAt } = payload;
    set((s) => ({
      stage,
      stageIndex,
      viewedStageIndex: stageIndex,
      subPhase: null,
      ...(s.joined && s.connected && s.name
        ? { me: { ...s.me, name: s.name, enteredStageAt: enteredStageAt ?? null, enteredStageIndex: stageIndex } }
        : {}),
    }));
    runKernelHooks('stageChange', payload);
  });

  socket.on('stage:sub-phase', (payload = {}) => {
    if (payload.stage !== get().stage) return;
    set({ subPhase: payload.subPhase ?? null });
  });

  socket.on('classroom:reset', (payload = {}) => {
    safeRemove(NAME_KEY);
    safeRemove(EPOCH_KEY);
    set({
      name: null,
      classEpoch: null,
      joined: false,
      hydrated: false,
      me: { ...EMPTY_ME },
      myStageData: {},
      classData: {},
      validationError: null,
      resetNotice: resetNoticeFor(payload),
    });
    resetSlices();
    resetComponentSlices();
    runKernelHooks('reset', payload);
  });

  socket.on('student:joined', ({ name, counts } = {}) => {
    set((s) => {
      const exists = s.roster.some((r) => r.name === name);
      return {
        roster: exists
          ? s.roster.map((r) => (r.name === name ? { ...r, connected: true } : r))
          : [...s.roster, { name, connected: true }],
        counts: counts || s.counts,
      };
    });
  });

  socket.on('student:left', ({ name, counts } = {}) => {
    set((s) => ({
      roster: s.roster.map((r) => (r.name === name ? { ...r, connected: false } : r)),
      counts: counts || s.counts,
    }));
  });

  socket.on('classroom:roster-update', (roster) => {
    if (Array.isArray(roster)) set({ roster });
  });

  socket.on('classroom:roster-mode-update', ({ rosterMode, rosterNames, claimedNames } = {}) => {
    set({
      rosterMode: !!rosterMode,
      rosterNames: Array.isArray(rosterNames) ? rosterNames : [],
      claimedNames: Array.isArray(claimedNames) ? claimedNames : [],
    });
  });

  socket.on('classroom:name-claim-update', ({ claimedNames } = {}) => {
    set({ claimedNames: Array.isArray(claimedNames) ? claimedNames : [] });
  });

  socket.on('stage:my-data', ({ stageId, data } = {}) => {
    if (!stageId) return;
    set((s) => ({ myStageData: { ...s.myStageData, [stageId]: data } }));
  });

  socket.on('stage:class-update', ({ stageId, data } = {}) => {
    if (!stageId) return;
    set((s) => ({ classData: { ...s.classData, [stageId]: data } }));
  });

  socket.on('error:validation', ({ event, message } = {}) => {
    // 带时间戳，供 StudentApp 显示一句话提示并在几秒后自动消失
    set({ validationError: { event, message, at: Date.now() } });
  });
}

export const useCoreStudentStore = coreStudentStore;
export default coreStudentStore;
