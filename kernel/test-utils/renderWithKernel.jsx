// 规格 v0.5 §2.7：renderWithKernel(ui, { role, stage, stageIndex, subPhase, roster, stageData, myStageData, classData, components, me, classEpoch, myDrafts, lessonId })
//   K2（v0.6）：classEpoch 只对学生端生效（教师 store 不保存 classEpoch）；不传时保留 store 初始值
//   → 渲染 ui 并预置对应 core store 与组件注册表，返回 { emit(event, payload), store, sent }
//   sent: [{ event, payload }]（规格 v0.3.1）：本次渲染后客户端经 socket 发往服务端的全部事件（含 send / advance 等）
// - 只在 vitest（jsdom）里使用；经 #kernel/test-utils/index.js 的惰性导出加载（服务端不加载 React）
// - 不连网：内核 socket 的 connect 被替换为空操作、emit（客户端发往服务端）只记入本次调用的 sent；
//   emit(event, payload) 在 act() 里把事件交给 core store 与阶段 / 组件切片的监听器，模拟服务端推送
//   （含 stage:change、stage:data-update、classroom:reset 等）
// - 每次调用先把该角色的 core store 与全部切片重置为初始值，再写入预置
// - components 项为 classroom:state.components 的形状 { id, label?, options?, stages? }，也可直接写组件 id 字符串
// - ui 包在本端角色上下文里（useComponent().role、镜像取本端 store 依赖它）
import { act } from 'react';
import { render } from '@testing-library/react';
import { socket } from '#kernel/client/socket.js';
import { coreStudentStore } from '#kernel/client/stores/coreStudentStore.js';
import { coreTeacherStore } from '#kernel/client/stores/coreTeacherStore.js';
import { resetSlices } from '#kernel/client/stores/stageStores.js';
import { resetComponentSlices } from '#kernel/client/stores/componentRegistry.js';
import { KernelRoleContext } from '#kernel/client/hooks/roleContext.js';

function normalizeComponents(list) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    if (typeof c === 'string') return { id: c, label: c, options: {}, stages: null };
    return {
      id: c.id,
      label: c.label ?? c.id,
      options: c.options && typeof c.options === 'object' ? c.options : {},
      stages: Array.isArray(c.stages) ? c.stages : null,
    };
  });
}

function normalizeStageData(raw) {
  const out = {};
  for (const [id, v] of Object.entries(raw || {})) {
    out[id] = {
      perStudent: v && v.perStudent && typeof v.perStudent === 'object' ? v.perStudent : {},
      perClass: v && v.perClass && typeof v.perClass === 'object' ? v.perClass : {},
    };
  }
  return out;
}

let socketStubbed = false;
let currentSent = [];
function stubSocket() {
  if (socketStubbed) return;
  socketStubbed = true;
  socket.connect = () => socket;
  socket.emit = (event, payload) => {
    currentSent.push({ event, payload });
    return socket;
  };
}

function deliver(event, payload) {
  if (typeof socket.receive === 'function') {
    socket.receive(event, payload); // 测试自带的假 socket
    return;
  }
  const any = typeof socket.listenersAny === 'function' ? socket.listenersAny() : [];
  for (const fn of any) fn(event, payload);
  for (const fn of socket.listeners(event)) fn(payload);
}

export function renderWithKernel(ui, opts = {}) {
  const {
    role = 'student',
    stage = 'prelogin',
    stageIndex = 0,
    subPhase = null,
    roster = [],
    stageData = {},
    myStageData = {},
    classData = {},
    components = [],
    me,
    classEpoch,
    myDrafts = {},
    lessonId,
  } = opts;
  if (role !== 'student' && role !== 'teacher') throw new Error(`renderWithKernel: role must be 'student' | 'teacher', got ${role}`);
  const store = role === 'teacher' ? coreTeacherStore : coreStudentStore;

  stubSocket();
  const sent = [];
  currentSent = sent;
  store.setState(store.getInitialState(), true);
  store.getState().connect(); // 绑定监听器（connect 已被替换为空操作，不会连网）
  resetSlices();
  resetComponentSlices();

  const common = {
    stage,
    stageIndex,
    viewedStageIndex: stageIndex,
    subPhase,
    roster: Array.isArray(roster) ? roster : [],
    components: normalizeComponents(components),
  };
  if (role === 'teacher') {
    const data = normalizeStageData(stageData);
    store.setState({
      ...common,
      token: store.getState().token || 'test-token',
      authenticated: true,
      joined: true,
      stageData: data,
      liveStageData: data,
    });
  } else {
    const m = {
      name: me && me.name != null ? me.name : null,
      enteredStageAt: me && me.enteredStageAt != null ? me.enteredStageAt : null,
      enteredStageIndex: me && me.enteredStageIndex != null ? me.enteredStageIndex : null,
    };
    store.setState({
      ...common,
      name: m.name,
      joined: true,
      hydrated: true,
      connected: true,
      me: m,
      myStageData: myStageData || {},
      classData: classData || {},
      myDrafts: myDrafts || {},
      ...(lessonId !== undefined ? { lesson: { ...store.getState().lesson, id: lessonId } } : {}),
      ...(classEpoch !== undefined ? { classEpoch } : {}),
    });
  }

  render(<KernelRoleContext.Provider value={role}>{ui}</KernelRoleContext.Provider>);

  function emit(event, payload) {
    act(() => deliver(event, payload));
  }
  return { emit, store, sent };
}
