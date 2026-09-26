// 教师端核心 store（规格 §9.1；载荷按规格 §5 / §5.1 / §5.2 / §5.3 / §6.1）
//
// 约定（已获协调方认可）：
// - 暂停：pauseStats 冻结展示用的 stageData；推送照常写入内部 liveStageData，并把暂停期间收到的
//   stage:data-update / stage:class-update 条数记入 statsPending；resumeStats 一次写回并清零。
//   暂停不跨阶段：stage:change 时自动恢复（写回 live、清零计数）。
//   DataTable 默认用法读 statsPaused / statsPending；传了 paused 时由其自行冻结行并计数。
// - v0.5：stageId 为 component:* 的 data-update / class-update 不参与冻结：同时写 stageData 与 liveStageData，
//   不计入 statsPending（镜像与分享要求实时）。
// - advance(force)：回看时（viewedStageIndex !== stageIndex）不发；force 只认布尔 true，
//   阶段视图经 useTeacherStage().advance 调用这里；send('teacher:advance') 会抛错（见 hooks/useStage.js）。
import { create } from 'zustand';
import { socket } from '../socket.js';
import { runKernelHooks } from './kernelHooks.js';
import { bindStageSlices, resetSlices } from './stageStores.js';
import { bindComponentSlices, resetComponentSlices } from './componentRegistry.js';
import { mapPublicState, EMPTY_LESSON, EMPTY_COUNTS } from './publicState.js';

const TOKEN_KEY = 'teacher_token';

function safeRead(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function safeWrite(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* 存储不可用 */ }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch (_) { /* 存储不可用 */ }
}

const EMPTY_STAGE = Object.freeze({ perStudent: {}, perClass: {} });
const isComponentStage = (stageId) => typeof stageId === 'string' && stageId.startsWith('component:');

function withStudent(stageData, stageId, name, data) {
  const cur = stageData[stageId] || EMPTY_STAGE;
  return { ...stageData, [stageId]: { ...cur, perStudent: { ...cur.perStudent, [name]: data } } };
}
function withClass(stageData, stageId, data) {
  const cur = stageData[stageId] || EMPTY_STAGE;
  return { ...stageData, [stageId]: { ...cur, perClass: data } };
}
function normalizeStageData(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw)) {
    out[id] = {
      perStudent: v && v.perStudent && typeof v.perStudent === 'object' ? v.perStudent : {},
      perClass: v && v.perClass && typeof v.perClass === 'object' ? v.perClass : {},
    };
  }
  return out;
}

let listenersBound = false;

export const coreTeacherStore = create((set, get) => ({
  token: safeRead(TOKEN_KEY),
  authenticated: false,
  joined: false,
  stage: 'prelogin',
  stageIndex: 0,
  subPhase: null,
  viewedStageIndex: 0,
  viewMode: 'stats',
  roster: [],
  counts: { ...EMPTY_COUNTS },
  rosterMode: false,
  rosterNames: [],
  claimedNames: [],
  stages: [],
  components: [],
  lesson: EMPTY_LESSON,
  advanceError: null,
  statsPaused: false,
  statsPending: 0,
  studentDetail: null,
  // 展示用（暂停时冻结）；liveStageData 始终为最新
  stageData: {},
  liveStageData: {},
  adminError: null,
  // 最近一次 teacher:admin-ok（外壳内部用，如导入成功后清空文本框）；seq 递增保证同名动作也能触发
  lastAdminOk: null,

  async login(password) {
    let res;
    try {
      res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
    } catch (_) {
      return { ok: false, error: '无法连接服务器' };
    }
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    if (!res.ok || !body || typeof body.token !== 'string') {
      return { ok: false, error: (body && body.error) || `登录失败（${res.status}）` };
    }
    safeWrite(TOKEN_KEY, body.token);
    set({ token: body.token, authenticated: true });
    return { ok: true, token: body.token };
  },

  connect(token) {
    if (typeof token === 'string' && token && token !== get().token) {
      safeWrite(TOKEN_KEY, token);
      set({ token });
    }
    bindStageSlices(socket);
    bindComponentSlices(socket);
    if (!listenersBound) {
      listenersBound = true;
      bindListeners(set, get);
    }
    if (!socket.connected) {
      socket.connect();
      return;
    }
    const cur = get().token;
    if (cur) socket.emit('teacher:join', { token: cur });
  },

  // 回看时不发；force 只接受布尔 true（防止把 React 事件对象当参数）
  advance(force) {
    const s = get();
    if (s.viewedStageIndex !== s.stageIndex) return;
    socket.emit('teacher:advance', { force: force === true });
  },

  setViewMode(mode) {
    if (mode !== 'demo' && mode !== 'stats') return;
    set({ viewMode: mode });
  },

  setViewedStageIndex(idx) {
    const { stageIndex } = get();
    if (!Number.isInteger(idx) || idx < 0 || idx > stageIndex) return;
    set({ viewedStageIndex: idx });
  },

  pauseStats() {
    set({ statsPaused: true, statsPending: 0 });
  },

  resumeStats() {
    set((s) => ({ statsPaused: false, statsPending: 0, stageData: s.liveStageData }));
  },

  fetchStudentDetail(name) {
    if (typeof name !== 'string' || !name.trim()) return;
    const n = name.trim();
    set({ studentDetail: { name: n, snapshot: undefined } });
    socket.emit('teacher:get-student-detail', { name: n });
  },

  clearStudentDetail() {
    set({ studentDetail: null });
  },

  importRoster(text) {
    if (typeof text !== 'string') return;
    set({ adminError: null });
    socket.emit('teacher:import-roster', { text });
  },

  clearRoster() {
    set({ adminError: null });
    socket.emit('teacher:clear-roster', {});
  },

  releaseBinding(name) {
    if (typeof name !== 'string' || !name.trim()) return;
    set({ adminError: null });
    socket.emit('teacher:release-binding', { name: name.trim() });
  },

  resetClassroom() {
    set({ adminError: null });
    socket.emit('teacher:reset-classroom', { confirm: true });
  },
}));

// 教师 store 不保存 classEpoch
function teacherPublic(data, s) {
  const out = mapPublicState(data, s);
  delete out.classEpoch;
  return out;
}

function bindListeners(set, get) {
  socket.on('connect', () => {
    const cur = get().token;
    if (cur) socket.emit('teacher:join', { token: cur });
  });

  // 断开即视为未入会：避免断网期间的操作先于 teacher:join 到达服务端
  socket.on('disconnect', () => set({ joined: false }));

  // teacher:join-ok { state, stageData }（规格 §5.2）
  socket.on('teacher:join-ok', (data = {}) => {
    const hasData = data && data.stageData && typeof data.stageData === 'object';
    set((s) => {
      const live = hasData ? normalizeStageData(data.stageData) : s.liveStageData;
      return {
        ...teacherPublic(data && data.state, s),
        authenticated: true,
        joined: true,
        advanceError: null,
        statsPaused: false,
        statsPending: 0,
        liveStageData: live,
        stageData: live,
      };
    });
  });

  socket.on('teacher:join-error', () => {
    safeRemove(TOKEN_KEY);
    set({ token: null, authenticated: false, joined: false, advanceError: null });
  });

  socket.on('classroom:state', (data) => {
    if (!data || typeof data !== 'object') return;
    set((s) => teacherPublic(data, s));
  });

  socket.on('stage:change', (payload = {}) => {
    const { stage, stageIndex } = payload;
    // 暂停不跨阶段：自动恢复并写回最新数据
    set((s) => ({
      stage,
      stageIndex,
      viewedStageIndex: stageIndex,
      subPhase: null,
      advanceError: null,
      statsPaused: false,
      statsPending: 0,
      stageData: s.liveStageData,
    }));
    runKernelHooks('stageChange', payload);
  });

  socket.on('stage:sub-phase', (payload = {}) => {
    if (payload.stage !== get().stage) return;
    set({ subPhase: payload.subPhase ?? null });
  });

  socket.on('teacher:advance-error', ({ reason, soft } = {}) => {
    set({ advanceError: { reason: reason ?? '', soft: !!soft } });
  });

  socket.on('stage:data-update', ({ stageId, name, data } = {}) => {
    if (!stageId || typeof name !== 'string') return;
    set((s) => {
      if (isComponentStage(stageId)) {
        return {
          liveStageData: withStudent(s.liveStageData, stageId, name, data),
          stageData: withStudent(s.stageData, stageId, name, data),
        };
      }
      const live = withStudent(s.liveStageData, stageId, name, data);
      return s.statsPaused
        ? { liveStageData: live, statsPending: s.statsPending + 1 }
        : { liveStageData: live, stageData: live };
    });
  });

  socket.on('stage:class-update', ({ stageId, data } = {}) => {
    if (!stageId) return;
    set((s) => {
      if (isComponentStage(stageId)) {
        return {
          liveStageData: withClass(s.liveStageData, stageId, data),
          stageData: withClass(s.stageData, stageId, data),
        };
      }
      const live = withClass(s.liveStageData, stageId, data);
      return s.statsPaused
        ? { liveStageData: live, statsPending: s.statsPending + 1 }
        : { liveStageData: live, stageData: live };
    });
  });

  socket.on('classroom:roster-update', (roster) => {
    if (Array.isArray(roster)) set({ roster });
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

  // 名字守卫：只接受当前打开的学生的详情
  // teacher:student-detail { name, stageData:{ [stageId]: record }, events:[{ stageId, type, payload, ts }] }（规格 §5.3）
  // snapshot 即该对象；载荷不是对象时记为 null（空）
  socket.on('teacher:student-detail', (data) => {
    const cur = get().studentDetail;
    if (!cur || !data || cur.name !== data.name) return;
    const snapshot = typeof data === 'object'
      ? {
        name: data.name,
        stageData: data.stageData && typeof data.stageData === 'object' ? data.stageData : {},
        events: Array.isArray(data.events) ? data.events : [],
      }
      : null;
    set({ studentDetail: { ...cur, snapshot } });
  });

  socket.on('teacher:admin-ok', ({ action } = {}) => {
    set((s) => ({ adminError: null, lastAdminOk: { action, seq: (s.lastAdminOk ? s.lastAdminOk.seq : 0) + 1 } }));
  });
  socket.on('teacher:admin-error', ({ action, message } = {}) => {
    // 详情取数失败 → 弹窗显示空态
    if (action === 'get-student-detail') {
      const cur = get().studentDetail;
      if (cur) set({ studentDetail: { ...cur, snapshot: null } });
    }
    set({ adminError: { action, message } });
  });

  socket.on('classroom:reset', (payload = {}) => {
    set({ stageData: {}, liveStageData: {}, statsPaused: false, statsPending: 0, studentDetail: null, advanceError: null, subPhase: null });
    resetSlices();
    resetComponentSlices();
    runKernelHooks('reset', payload);
  });
}

export const useCoreTeacherStore = coreTeacherStore;
export default coreTeacherStore;
