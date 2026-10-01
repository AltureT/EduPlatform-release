// 阶段发现、组装与客户端切片（规格 §4、§9.1；契约 §四）
//
// 约定（已获协调方认可）：阶段清单一致性比对只看"服务端 stages 里有、本地 glob 没发现"的 id；
// 本地多出的目录（未列入 lesson.config.stages，或谢幕 override 目录）不算阶段，忽略。
//
// v0.8（活动原语规格 §2.3）：stage.config.primitive 非 null 的阶段，视图取阶段目录同名文件，否则取
// @primitives/<type>/ 的默认视图；两边都没有才放占位。slice 只看阶段目录的 store.js。
// 有效 config（effectiveStageConfig）= 阶段 config + 原语的 layout / collect / subPhases / alerts（按 classroom:state 的
// options 求值，原语在前、阶段追加）+ gate / recommend / score / summarize（阶段优先，share 组件在客户端调用）+ options；
// onEnter / onLeave / onLateJoin 只在服务端运行，客户端不合并。
// P2：原语阶段的 sandbox（原语 defaults.sandbox(options) 的结果）由服务端经 classroom:state.stages[i].sandbox 下发，
// 这里原样并入有效 config（sandbox 组件从 stage.sandbox 读）；非原语阶段不合并，照旧读自己 stage.config 的 sandbox。
// 注意：学生端的 options 已去掉保密选项（服务端按角色下发），依赖它们求值的项在学生端与教师端不同——
// 如 vote 在学生端 subPhases 为 undefined（没有 answer）、collect 里没有 correct、score 只按"是否提交"。
// 学生视图判断子阶段看 hook 返回的 subPhase（服务端下发），不要读 stage.subPhases。
// 前端打包的 stage.config.js 没有 options（kernel/build/strip-stage-options.js 删掉），这里的 options 只来自 classroom:state。
import { createElement } from 'react';
import { create } from 'zustand';
import stageGlob, * as globModule from './stageGlob.js';

// T9a（教师视图与学生页重排规格 §2.2）：TeacherActions.jsx（教师操作条按钮，可选）与三个视图同规则——阶段目录有同名文件则整体替换原语的
const FILE_RE = /([^/\\]+)[/\\](stage\.config\.js|Student\.jsx|TeacherDemo\.jsx|TeacherStats\.jsx|TeacherActions\.jsx|store\.js)$/;
const FIELD = {
  'stage.config.js': 'config',
  'Student.jsx': 'Student',
  'TeacherDemo.jsx': 'TeacherDemo',
  'TeacherStats.jsx': 'TeacherStats',
  'TeacherActions.jsx': 'TeacherActions',
  'store.js': 'store',
};
const PRIMITIVE_FILE_RE = /([^/\\]+)[/\\](primitive\.config\.js|Student\.jsx|TeacherDemo\.jsx|TeacherStats\.jsx|TeacherActions\.jsx)$/;
const PRIMITIVE_FIELD = {
  'primitive.config.js': 'config',
  'Student.jsx': 'Student',
  'TeacherDemo.jsx': 'TeacherDemo',
  'TeacherStats.jsx': 'TeacherStats',
  'TeacherActions.jsx': 'TeacherActions',
};
const VIEWS = ['Student', 'TeacherDemo', 'TeacherStats', 'TeacherActions'];
const HOOK_OVERRIDE = ['gate', 'recommend', 'score', 'summarize'];
export const BUILTIN_STAGE_IDS = ['prelogin', 'curtain'];

// 测试里 vi.doMock('./stageGlob.js') 只给 default 时，读不到具名导出按"没有原语"处理
function defaultPrimitiveModules() {
  try {
    return globModule.primitiveGlob || {};
  } catch {
    return {};
  }
}

// 原语 glob 结果 → { [type]: { type, config, Student, TeacherDemo, TeacherStats } }；_ 开头的目录（_shared）不是原语
export function discoverPrimitives(modules = defaultPrimitiveModules()) {
  const byType = {};
  for (const [path, mod] of Object.entries(modules || {})) {
    const m = PRIMITIVE_FILE_RE.exec(path);
    if (!m) continue;
    const [, type, file] = m;
    if (type.startsWith('_')) continue;
    if (!byType[type]) byType[type] = { type, config: null, Student: null, TeacherDemo: null, TeacherStats: null, TeacherActions: null };
    byType[type][PRIMITIVE_FIELD[file]] = mod && 'default' in mod ? mod.default : null;
  }
  return byType;
}

// glob 结果 → { byDir, byId, primitives }；byId 只收有 stage.config.js 的目录
// v0.8：原语阶段的 entry 上 Student / TeacherDemo / TeacherStats 为解析后的视图（阶段目录优先，否则原语），
// entry.primitive 为原语条目（找不到时 null 并报错）
export function discoverStages(modules = stageGlob, primitiveModules = defaultPrimitiveModules()) {
  const primitives = discoverPrimitives(primitiveModules);
  const byDir = {};
  for (const [path, mod] of Object.entries(modules || {})) {
    const m = FILE_RE.exec(path);
    if (!m) continue;
    const [, dir, file] = m;
    if (!byDir[dir]) {
      byDir[dir] = { dir, config: null, Student: null, TeacherDemo: null, TeacherStats: null, TeacherActions: null, store: null };
    }
    byDir[dir][FIELD[file]] = mod && 'default' in mod ? mod.default : null;
  }
  const byId = {};
  for (const entry of Object.values(byDir)) {
    const id = entry.config && entry.config.id;
    if (typeof id !== 'string' || !id) continue;
    if (byId[id]) console.error(`[stages] 重复的阶段 id "${id}"：${byId[id].dir} 与 ${entry.dir}`);
    else byId[id] = entry;
  }
  for (const entry of Object.values(byId)) {
    const type = entry.config.primitive;
    entry.primitive = null;
    if (type == null) continue;
    const prim = primitives[type] || null;
    if (!prim || !prim.config) {
      console.error(`[stages] 阶段 "${entry.config.id}" 的原语 "${type}" 不存在`);
      continue;
    }
    entry.primitive = prim;
    for (const v of VIEWS) entry[v] = entry[v] || prim[v] || null;
    // layout 不依赖 options：直接并入注册表里的 config，镜像等直接读 entry.config 的地方也拿到原语的页面样式
    entry.config = { ...entry.config, layout: prim.config.layout || 'focus' };
  }
  return { byDir, byId, primitives };
}

// ── 有效 config（v0.8）──────────────────────────────
const effectiveCache = new WeakMap(); // entry → { options, key, config }

function mergePrimitiveClient(base, prim, options, sandbox) {
  const d = (prim.config && prim.config.defaults) || {};
  const make = (key) => {
    if (options == null) return undefined;
    const f = d[key];
    if (f === undefined) return undefined;
    if (key === 'collect' && typeof f === 'object') return f;
    try {
      return typeof f === 'function' ? f(options) : undefined;
    } catch (err) {
      console.error(`[stages] 原语 "${prim.type}" 的 defaults.${key}(options) 出错`, err);
      return undefined;
    }
  };
  const eff = { ...base, options: options ?? null, layout: (prim.config && prim.config.layout) || 'focus' };
  // P5：原语可给回看可交互的缺省（code / data-analysis 为 true），阶段写了以阶段为准（与服务端 mergePrimitiveConfig 同规则）
  if (base.reviewInteractive === undefined && prim.config && typeof prim.config.reviewInteractive === 'boolean') {
    eff.reviewInteractive = prim.config.reviewInteractive;
  }
  if (sandbox && typeof sandbox === 'object' && !Array.isArray(sandbox)) eff.sandbox = sandbox;
  const collect = make('collect');
  if (collect !== undefined) eff.collect = collect;
  const subPhases = make('subPhases');
  if (Array.isArray(subPhases)) eff.subPhases = subPhases;
  const primAlerts = make('alerts');
  const alerts = [...(Array.isArray(primAlerts) ? primAlerts : []), ...(Array.isArray(base.alerts) ? base.alerts : [])];
  if (alerts.length > 0) eff.alerts = alerts;
  // 组件在客户端调用 recommend / score（share）；gate / summarize 一并按"阶段优先"合并，与服务端同形
  for (const key of HOOK_OVERRIDE) {
    const fn = typeof base[key] === 'function' ? base[key] : make(key);
    if (typeof fn === 'function') eff[key] = fn;
  }
  return eff;
}

// entry 为 registry.byId[id]；options 为 classroom:state.stages[i].options（可为 null）；
// sandbox 为 classroom:state.stages[i].sandbox（原语阶段才有，可缺省）。
// 非原语阶段原样返回 entry.config；同一 options + sandbox（按内容）返回同一对象，便于 hooks 依赖比较
export function effectiveStageConfig(entry, options = null, sandbox = undefined) {
  if (!entry) return null;
  const base = entry.config;
  if (!base || base.primitive == null || !entry.primitive) return base;
  const cached = effectiveCache.get(entry);
  if (cached && cached.options === options && cached.sandbox === sandbox) return cached.config;
  const key = `${options == null ? '' : JSON.stringify(options)}\u0000${sandbox == null ? '' : JSON.stringify(sandbox)}`;
  if (cached && cached.key === key) {
    cached.options = options;
    cached.sandbox = sandbox;
    return cached.config;
  }
  const config = mergePrimitiveClient(base, entry.primitive, options, sandbox);
  effectiveCache.set(entry, { options, sandbox, key, config });
  return config;
}

let registryCache = null;
export function getStageRegistry() {
  if (!registryCache) {
    registryCache = discoverStages(stageGlob);
    initSlices(registryCache);
  }
  return registryCache;
}

function makePlaceholder(id, file) {
  function StagePlaceholder() {
    return createElement('div', {
      'data-testid': 'stage-placeholder',
      style: { padding: 24, color: 'var(--ink-dim)', fontFamily: 'ui-monospace, monospace' },
    }, `${id}/${file}`);
  }
  return StagePlaceholder;
}

const reported = new Set();
function reportMissing(id, file) {
  const key = `${id}/${file}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.error(`[stages] 阶段 "${id}" 缺少 ${file}`);
}

// 按 classroom:state.stages 顺序组装；prelogin / curtain 为内核阶段，组件为 null
// v0.8：config 为有效 config（原语阶段按 publicStage.options 合并），视图已按"阶段目录优先、否则原语"解析
export function assembleStages(publicStages, registry = getStageRegistry()) {
  if (!Array.isArray(publicStages)) return [];
  return publicStages.map((s) => {
    const id = s && s.id;
    const base = { id, label: s ? s.label : '', config: null, Student: null, TeacherDemo: null, TeacherStats: null, TeacherActions: null, slice: null };
    if (BUILTIN_STAGE_IDS.includes(id)) return base;
    const entry = registry.byId[id];
    if (!entry) {
      reportMissing(id, 'stage.config.js');
      return {
        ...base,
        Student: makePlaceholder(id, 'Student.jsx'),
        TeacherStats: makePlaceholder(id, 'TeacherStats.jsx'),
      };
    }
    if (!entry.Student) reportMissing(id, 'Student.jsx');
    if (!entry.TeacherStats) reportMissing(id, 'TeacherStats.jsx');
    return {
      ...base,
      config: effectiveStageConfig(entry, s.options ?? null, s.sandbox),
      Student: entry.Student || makePlaceholder(id, 'Student.jsx'),
      TeacherDemo: entry.TeacherDemo || null,
      TeacherStats: entry.TeacherStats || makePlaceholder(id, 'TeacherStats.jsx'),
      TeacherActions: entry.TeacherActions || null,
      slice: entry.store || null,
    };
  });
}

// 服务端阶段清单里有本地未发现的阶段 → 不一致（本地多出的未列入目录不算阶段，忽略）
export function findStageMismatch(publicStages, registry = getStageRegistry()) {
  if (!Array.isArray(publicStages) || publicStages.length === 0) return false;
  return publicStages.some((s) => s && !BUILTIN_STAGE_IDS.includes(s.id) && !registry.byId[s.id]);
}

// 谢幕 override：stagesDir 下的目录名
export function getCurtainOverride(dir, registry = getStageRegistry()) {
  if (!dir) return null;
  const entry = registry.byDir[dir];
  if (!entry) return null;
  return { Student: entry.Student || null, TeacherStats: entry.TeacherStats || null };
}

// ── 切片 ─────────────────────────────────────────────
export const useStageSlices = create(() => ({ student: {}, teacher: {} }));

function initialsOf(registry, role) {
  const out = {};
  for (const [id, entry] of Object.entries(registry.byId)) {
    const def = entry.store && entry.store[role];
    if (def && 'initial' in def) out[id] = def.initial;
  }
  return out;
}

function initSlices(registry) {
  useStageSlices.setState({ student: initialsOf(registry, 'student'), teacher: initialsOf(registry, 'teacher') });
}

export function resetSlices() {
  const registry = getStageRegistry();
  initSlices(registry);
}

export function getSlice(role, id) {
  getStageRegistry();
  return useStageSlices.getState()[role][id];
}

// stage:<id>:<rest> → 该阶段 store.js 的 on[event]，返回整个新切片（替换）
export function dispatchStageEvent(event, payload) {
  if (typeof event !== 'string') return;
  const parts = event.split(':');
  if (parts.length < 3 || parts[0] !== 'stage') return;
  const id = parts[1];
  const registry = getStageRegistry();
  const entry = registry.byId[id];
  if (!entry || !entry.store) return;
  const cur = useStageSlices.getState();
  const next = { ...cur };
  let changed = false;
  for (const role of ['student', 'teacher']) {
    const handler = entry.store[role] && entry.store[role].on && entry.store[role].on[event];
    if (typeof handler !== 'function') continue;
    try {
      next[role] = { ...cur[role], [id]: handler(cur[role][id], payload) };
      changed = true;
    } catch (err) {
      console.error(`[stage:${id}] 切片处理 ${event} 出错`, err);
    }
  }
  if (changed) useStageSlices.setState(next);
}

const boundSockets = new WeakSet();
export function bindStageSlices(socket) {
  if (!socket || boundSockets.has(socket)) return;
  boundSockets.add(socket);
  getStageRegistry();
  socket.onAny((event, payload) => dispatchStageEvent(event, payload));
}
