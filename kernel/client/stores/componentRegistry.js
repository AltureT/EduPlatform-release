// 组件注册表与组件切片（规格 v0.5 §2.3）
// - discoverComponents(glob) → { byId: { [id]: { id, slots, store } } }（按目录名；client.jsx 默认导出 { slots, store }）
// - assembleComponents(publicComponents) → [{ id, label, options, stages, slots, store }]，按 classroom:state.components 顺序；
//   只含服务端已打开的组件；本地缺 client.jsx 的组件 slots = {}、store = null
// - 切片：语义同阶段 store.js —— 处理函数返回整个新切片；classroom:reset 回 initial；
//   '<id>:<event>' 服务端事件按第一段路由到该组件 store 的 student / teacher 两端处理函数
// - setComponentLocal(role, id, patch)：浅合并写入本端切片（useComponent().setLocal）
import { create } from 'zustand';
import componentGlob from './componentGlob.js';

const FILE_RE = /([^/\\]+)[/\\]client\.jsx$/;
const EMPTY_SLOTS = Object.freeze({});

// 槽位清单（可选组件规格 §2.3；v0.7.1 加 studentBanner；C5 加 studentAside，由 <Page> 在学生视图里渲染）。
// 外壳按名字渲染，不在清单里的名字不会被渲染：discoverComponents 在开发模式下对清单外的 slots 键 console.warn（多半是拼错）
export const SLOT_NAMES = Object.freeze([
  'teacherToolbar', 'teacherMain', 'teacherSidebar', 'teacherOverlay', 'teacherCurtain',
  'studentOverlay', 'studentCurtain', 'studentBanner', 'studentAside',
]);
const DEV = (() => {
  try {
    return !!(import.meta.env && import.meta.env.DEV);
  } catch (_) {
    return false;
  }
})();

export function discoverComponents(modules = componentGlob) {
  const byId = {};
  for (const [path, mod] of Object.entries(modules || {})) {
    const m = FILE_RE.exec(path);
    if (!m) continue;
    const def = mod && mod.default && typeof mod.default === 'object' ? mod.default : {};
    if (DEV && def.slots && typeof def.slots === 'object') {
      for (const name of Object.keys(def.slots)) {
        if (!SLOT_NAMES.includes(name)) console.warn(`[components] ${m[1]} 的 slots.${name} 不是已知槽位`);
      }
    }
    byId[m[1]] = {
      id: m[1],
      slots: def.slots && typeof def.slots === 'object' ? def.slots : EMPTY_SLOTS,
      store: def.store && typeof def.store === 'object' ? def.store : null,
    };
  }
  return { byId };
}

let registryCache = null;
export function getComponentRegistry() {
  if (!registryCache) {
    registryCache = discoverComponents(componentGlob);
    initSlices(registryCache);
  }
  return registryCache;
}

export function assembleComponents(publicComponents, registry = getComponentRegistry()) {
  if (!Array.isArray(publicComponents)) return [];
  return publicComponents
    .filter((c) => c && typeof c.id === 'string')
    .map((c) => {
      const entry = registry.byId[c.id];
      return {
        id: c.id,
        label: c.label ?? '',
        options: c.options && typeof c.options === 'object' ? c.options : {},
        stages: Array.isArray(c.stages) ? c.stages : null,
        slots: entry ? entry.slots : EMPTY_SLOTS,
        store: entry ? entry.store : null,
      };
    });
}

// ── 切片 ─────────────────────────────────────────────
export const useComponentSlices = create(() => ({ student: {}, teacher: {} }));

function initialsOf(registry, role) {
  const out = {};
  for (const [id, entry] of Object.entries(registry.byId)) {
    const def = entry.store && entry.store[role];
    if (def && 'initial' in def) out[id] = def.initial;
  }
  return out;
}

function initSlices(registry) {
  useComponentSlices.setState({ student: initialsOf(registry, 'student'), teacher: initialsOf(registry, 'teacher') });
}

export function resetComponentSlices() {
  initSlices(getComponentRegistry());
}

export function getComponentSlice(role, id) {
  getComponentRegistry();
  return useComponentSlices.getState()[role][id];
}

export function setComponentLocal(role, id, patch) {
  getComponentRegistry();
  if (!patch || typeof patch !== 'object') return;
  const cur = useComponentSlices.getState();
  const prev = cur[role][id];
  const base = prev && typeof prev === 'object' ? prev : {};
  useComponentSlices.setState({ ...cur, [role]: { ...cur[role], [id]: { ...base, ...patch } } });
}

export function dispatchComponentEvent(event, payload) {
  if (typeof event !== 'string') return;
  const i = event.indexOf(':');
  if (i <= 0) return;
  const id = event.slice(0, i);
  const entry = getComponentRegistry().byId[id];
  if (!entry || !entry.store) return;
  const cur = useComponentSlices.getState();
  const next = { ...cur };
  let changed = false;
  for (const role of ['student', 'teacher']) {
    const handler = entry.store[role] && entry.store[role].on && entry.store[role].on[event];
    if (typeof handler !== 'function') continue;
    try {
      next[role] = { ...cur[role], [id]: handler(cur[role][id], payload) };
      changed = true;
    } catch (err) {
      console.error(`[component:${id}] 切片处理 ${event} 出错`, err);
    }
  }
  if (changed) useComponentSlices.setState(next);
}

const boundSockets = new WeakSet();
export function bindComponentSlices(socket) {
  if (!socket || boundSockets.has(socket)) return;
  boundSockets.add(socket);
  getComponentRegistry();
  socket.onAny((event, payload) => dispatchComponentEvent(event, payload));
}
