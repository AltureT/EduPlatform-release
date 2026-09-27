// 组件发现（规格 v0.5 §2.1）
// loadComponents(lessonConfig, componentsRoot, { lessonComponentsRoot? }) → [{ id, label, options, dir, origin, register?, static, http, requires, report }]
//   C5（课程本地组件规格 §2）：每个 id 先在 componentsRoot（平台组件）找，找不到再在 lessonComponentsRoot
//   （= <lesson.config.js 所在目录>/components，见 lessonComponentsRootOf）找；两处都有 → 重名错误；origin = 'platform' | 'lesson'。
//   lessonComponentsRoot 与 componentsRoot 是同一目录（模板根的 lesson.config.js）时视为没有课程组件。
//   课程组件 id 不得等于内置组件 id（BUILTIN_COMPONENT_IDS）。server.js 可选导出 report(name, cctx)（缺省 null）
//   K2（v0.6）：component.config.js 可选 static（{ '/前缀': '相对项目根的目录' }，缺省 null）、
//   requires（[{ path, hint }]，缺省 []）；server.js 可选导出 http(router, cctx)（缺省 null）
//   lesson.config.components：字符串 'id' 或 { id, ...options }；componentsRoot = <项目根>/components
//   components/<id>/component.config.js 必需（export default { id, label }）；server.js 可缺省（export function register(cctx)）；
//   client.jsx 只在客户端经 import.meta.glob 加载，这里不管
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMPONENT_ID_RE = /^[a-z][a-z0-9-]*$/;
export const RESERVED_COMPONENT_IDS = ['stage', 'student', 'teacher', 'classroom', 'error', 'component'];
// 内置组件的固定 id（也是阶段不得使用的事件前缀，见 stage-context.js）
export const BUILTIN_COMPONENT_IDS = ['share', 'inbox', 'report', 'mirror', 'coach', 'sandbox', 'web-sim'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// lesson.config.components 的一项 → { id, options }；不做存在性检查
export function parseComponentEntry(entry) {
  if (typeof entry === 'string') return { id: entry, options: {} };
  if (isPlainObject(entry)) {
    const { id, ...options } = entry;
    return { id, options };
  }
  throw new Error(`lesson config: invalid component entry ${JSON.stringify(entry)} (must be 'id' or { id, ...options })`);
}

// 只取 id（stage-loader 用于校验 stage.config.components 引用）
export function componentIdsOf(lessonConfig) {
  const list = lessonConfig?.components;
  if (!Array.isArray(list)) return [];
  const ids = [];
  for (const e of list) {
    if (typeof e === 'string') ids.push(e);
    else if (isPlainObject(e) && typeof e.id === 'string') ids.push(e.id);
  }
  return ids;
}

// K2（v0.6）：static 键不得占用内核路径（/api、/socket.io、/assets 前缀；SPA 路由 /teacher）
const STATIC_FORBIDDEN_PREFIXES = ['/api', '/socket.io', '/assets'];
const STATIC_FORBIDDEN_EXACT = ['/', '/teacher'];

// component.config.js 的 static：{ [URL 前缀]: 相对项目根的目录 } → 原样返回（解析为绝对路径由 createApp 负责）；缺省 null
function parseStatic(id, decl) {
  if (decl === undefined || decl === null) return null;
  if (!isPlainObject(decl)) throw new Error(`component "${id}": static must be an object { '/prefix': 'dir' }`);
  const out = {};
  for (const [key, dir] of Object.entries(decl)) {
    if (!key.startsWith('/') || STATIC_FORBIDDEN_EXACT.includes(key) || STATIC_FORBIDDEN_PREFIXES.some((p) => key.startsWith(p))) {
      throw new Error(`component "${id}": static prefix ${JSON.stringify(key)} is not allowed (must start with /, not be / or /teacher, not start with ${STATIC_FORBIDDEN_PREFIXES.join(' / ')})`);
    }
    if (typeof dir !== 'string' || dir.trim() === '' || path.isAbsolute(dir)) {
      throw new Error(`component "${id}": static[${JSON.stringify(key)}] must be a non-empty directory path relative to the project root`);
    }
    out[key] = dir;
  }
  return out;
}

// component.config.js 的 requires：[{ path, hint }]（供启动前检查；内核不消费）；缺省 []
function parseRequires(id, decl) {
  if (decl === undefined || decl === null) return [];
  if (!Array.isArray(decl)) throw new Error(`component "${id}": requires must be an array of { path, hint }`);
  return decl.map((r, i) => {
    if (!isPlainObject(r) || typeof r.path !== 'string' || r.path.trim() === '' || typeof r.hint !== 'string') {
      throw new Error(`component "${id}": requires[${i}] must be { path: non-empty string, hint: string }`);
    }
    return { path: r.path, hint: r.hint };
  });
}

function validateId(id) {
  if (typeof id !== 'string' || !COMPONENT_ID_RE.test(id)) {
    throw new Error(`component: invalid id ${JSON.stringify(id)} (must match ${COMPONENT_ID_RE})`);
  }
  if (RESERVED_COMPONENT_IDS.includes(id)) throw new Error(`component: id "${id}" is reserved`);
}

// C5：课程组件目录 = <lesson.config.js 所在目录>/components
export function lessonComponentsRootOf(configPath) {
  return path.join(path.dirname(path.resolve(configPath)), 'components');
}

// C5：id 对应的组件目录与来源；平台优先，两处都有 → 重名错误，都没有 → unknown component
export function locateComponent(id, componentsRoot, lessonComponentsRoot) {
  const platformDir = path.join(componentsRoot, id);
  const lessonRoot = lessonComponentsRoot && path.resolve(lessonComponentsRoot) !== path.resolve(componentsRoot)
    ? lessonComponentsRoot
    : null;
  const lessonDir = lessonRoot ? path.join(lessonRoot, id) : null;
  const inPlatform = fs.existsSync(platformDir);
  const inLesson = lessonDir !== null && fs.existsSync(lessonDir);
  if (inPlatform && inLesson) {
    throw new Error(`component "${id}": 课程组件 ${id} 与平台组件重名，请改名（${lessonDir}）`);
  }
  if (inPlatform) return { dir: platformDir, origin: 'platform' };
  if (inLesson) {
    if (BUILTIN_COMPONENT_IDS.includes(id)) {
      throw new Error(`component "${id}": 课程组件 id "${id}" 是平台内置组件的名字，请改名（建议 x- 开头）`);
    }
    return { dir: lessonDir, origin: 'lesson' };
  }
  const where = lessonDir ?? path.join('lessons', '<课程目录>', 'components', id);
  throw new Error(`component "${id}": unknown component (no directory ${platformDir}；或在 ${where}${path.sep} 下建一个课程组件)`);
}

export async function loadComponents(lessonConfig, componentsRoot, { lessonComponentsRoot = null } = {}) {
  const list = lessonConfig?.components ?? [];
  if (!Array.isArray(list)) throw new Error('lesson config: components must be an array');
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    const { id, options } = parseComponentEntry(entry);
    validateId(id);
    if (seen.has(id)) throw new Error(`component "${id}": duplicate id in lesson config`);
    seen.add(id);

    const { dir, origin } = locateComponent(id, componentsRoot, lessonComponentsRoot);
    const cfgFile = path.join(dir, 'component.config.js');
    if (!fs.existsSync(cfgFile)) throw new Error(`component "${id}": missing component.config.js (${cfgFile})`);
    const config = (await import(pathToFileURL(cfgFile).href)).default;
    if (!isPlainObject(config)) throw new Error(`component "${id}": component.config.js must export default an object`);
    if (config.id !== id) {
      throw new Error(`component "${id}": component.config.js id ${JSON.stringify(config.id)} does not match directory`);
    }
    if (typeof config.label !== 'string' || config.label.trim() === '') {
      throw new Error(`component "${id}": label must be a non-empty string`);
    }

    const item = {
      id,
      label: config.label,
      options,
      dir,
      origin,
      static: parseStatic(id, config.static),
      http: null,
      requires: parseRequires(id, config.requires),
      report: null,
    };
    const serverFile = path.join(dir, 'server.js');
    if (fs.existsSync(serverFile)) {
      const mod = await import(pathToFileURL(serverFile).href);
      if (typeof mod.register !== 'function') throw new Error(`component "${id}": server.js must export function register(cctx)`);
      item.register = mod.register;
      if (mod.http !== undefined) {
        if (typeof mod.http !== 'function') throw new Error(`component "${id}": server.js export http must be a function http(router, cctx)`);
        item.http = mod.http;
      }
      // C5（课程本地组件规格 §4）：可选 report(name, cctx) → [{ label, value, format? }]，由 report 组件在各阶段之后调用
      if (mod.report !== undefined) {
        if (typeof mod.report !== 'function') throw new Error(`component "${id}": server.js export report must be a function report(name, cctx)`);
        item.report = mod.report;
      }
    }
    out.push(item);
  }
  return out;
}
