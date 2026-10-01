// 课程与阶段发现（规格 §4）
// loadLesson(configPath, { primitivesRoot? }) → { lessonConfig, stagesRoot, stages: [{ id, dir, config, hasDemo, primitiveDir, secretOptions, serverOptions }], stagesHash }
//   （不 import server.js）
// loadStageServers(stages) → Map<id, register>
//
// v0.8（活动原语规格 §2、契约 §五）：stage.config.primitive 非 null 时，从 <项目根>/primitives/<type>/ 取原语：
//   primitive.config.js = { type, label, layout, options: 校验函数（shape(...) 或同形函数）, requiresComponents?, normalize?, secretOptions?, reviewInteractive?（P5，布尔缺省）,
//                           defaults: { gate, collect, alerts, subPhases, recommend, score, summarize, onEnter, onLeave, onLateJoin, sandbox } }
//   defaults 每项是 (options) => 值 的工厂（collect 也可直接写对象），值与契约 §二 同形。
//   加载顺序：{ from } 引用读入 → await normalize(options, { stageDir, readFrom, readBinaryFrom }) → 摘出 $server → options 校验 → ≤ 256 KB → 按 §2.3 合并为有效 config。
//   stages[i].config 即合并后的有效 config（gate / 钩子 / collect / alerts / subPhases / layout / options / sandbox），内核其余部分不区分原语。
// P3（活动原语规格 §2.9 仅服务端选项）：normalize 返回的 options 可带保留键 $server（对象）——不下发（config.options 里没有它）、
//   不计入 256 KB、不参与 options 校验；defaults 工厂与原语 register(ctx, options) 拿含 $server 的完整 options（stages[i].serverOptions）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { componentIdsOf } from './component-loader.js';
import { lessonIdError } from './lesson-db-path.js';

export const STAGE_ID_RE = /^[a-z][a-z0-9-]*$/;
export const RESERVED_STAGE_IDS = ['prelogin', 'curtain'];
// v0.5：recommend / score / summarize 为组件消费的可选钩子（契约 §二），内核只校验类型
const HOOKS = ['gate', 'onEnter', 'onLeave', 'onLateJoin', 'recommend', 'score', 'summarize'];

export const DEFAULT_PRIMITIVES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'primitives');
export const PRIMITIVE_TYPE_RE = /^[a-z][a-z0-9-]*$/;
// P0 返工 S3：两个上限统一为 256 KB（P2 的数据集走 { from }）
export const OPTIONS_MAX_BYTES = 256 * 1024; // 校验后的 options 序列化上限
export const FROM_MAX_BYTES = 256 * 1024; // { from } 与 normalize 的 readFrom / readBinaryFrom：单文件与每阶段合计上限
export const SERVER_OPTIONS_KEY = '$server'; // P3：仅服务端选项的保留键
const HOOK_CHAIN = ['onEnter', 'onLeave', 'onLateJoin'];
const HOOK_OVERRIDE = ['gate', 'recommend', 'score', 'summarize'];
const STAGE_FIXED = ['collect', 'subPhases', 'layout'];

export function stagesHash(ids) {
  return crypto.createHash('sha1').update(ids.join(',')).digest('hex');
}

async function importDefault(file) {
  const mod = await import(pathToFileURL(file).href);
  return mod.default;
}

function validateStageConfig(dirName, config, seen, openComponents) {
  const where = `stage "${dirName}"`;
  if (!config || typeof config !== 'object') throw new Error(`${where}: stage.config.js must export default an object`);
  const { id } = config;
  if (typeof id !== 'string' || !STAGE_ID_RE.test(id)) {
    throw new Error(`${where}: invalid id ${JSON.stringify(id)} (must match ${STAGE_ID_RE})`);
  }
  if (RESERVED_STAGE_IDS.includes(id)) throw new Error(`${where}: id "${id}" is reserved`);
  if (seen.has(id)) throw new Error(`${where}: duplicate id "${id}" (also in "${seen.get(id)}")`);
  if (typeof config.label !== 'string' || config.label.trim() === '') throw new Error(`${where}: label must be a non-empty string`);
  for (const h of HOOKS) {
    if (config[h] !== undefined && typeof config[h] !== 'function') throw new Error(`${where}: ${h} must be a function`);
  }
  // v0.8：primitive 为 null / 缺省，或原语目录名
  if (config.primitive != null && (typeof config.primitive !== 'string' || !PRIMITIVE_TYPE_RE.test(config.primitive))) {
    throw new Error(`${where}: invalid primitive ${JSON.stringify(config.primitive)} (must be null or match ${PRIMITIVE_TYPE_RE})`);
  }
  if (config.subPhases !== undefined) {
    if (!Array.isArray(config.subPhases) || !config.subPhases.every((x) => typeof x === 'string')) {
      throw new Error(`${where}: subPhases must be an array of strings`);
    }
  }
  // v0.5：只能引用 lesson.config.components 已打开的组件
  if (config.components !== undefined) {
    if (!Array.isArray(config.components) || !config.components.every((x) => typeof x === 'string')) {
      throw new Error(`${where}: components must be an array of component ids`);
    }
    for (const cid of config.components) {
      if (!openComponents.includes(cid)) {
        throw new Error(`${where}: components references "${cid}", which is not enabled in lesson config components`);
      }
    }
  }
}

// ── 原语（v0.8）─────────────────────────────────────
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const kb = (n) => Math.ceil(n / 1024);

async function loadPrimitive(type, primitivesRoot, cache) {
  if (cache.has(type)) return cache.get(type);
  const dir = path.join(primitivesRoot, type);
  const file = path.join(dir, 'primitive.config.js');
  if (!fs.existsSync(file)) {
    cache.set(type, null);
    return null;
  }
  const def = await importDefault(file);
  const where = `原语"${type}"`;
  if (!isPlainObject(def)) throw new Error(`${where}：primitive.config.js 必须默认导出对象`);
  if (def.type !== type) throw new Error(`${where}：type 必须与目录名一致（得到 ${JSON.stringify(def.type)}）`);
  if (typeof def.options !== 'function') throw new Error(`${where}：options 必须是校验函数（shape({...})）`);
  if (def.normalize !== undefined && typeof def.normalize !== 'function') throw new Error(`${where}：normalize 必须是函数`);
  if (def.requiresComponents !== undefined
    && !(Array.isArray(def.requiresComponents) && def.requiresComponents.every((x) => typeof x === 'string'))) {
    throw new Error(`${where}：requiresComponents 必须是组件 id 数组`);
  }
  if (def.secretOptions !== undefined
    && !(Array.isArray(def.secretOptions) && def.secretOptions.every((x) => typeof x === 'string'))) {
    throw new Error(`${where}：secretOptions 必须是 options 键名数组`);
  }
  if (def.reviewInteractive !== undefined && typeof def.reviewInteractive !== 'boolean') {
    throw new Error(`${where}：reviewInteractive 必须是 true / false`);
  }
  if (def.defaults !== undefined && !isPlainObject(def.defaults)) throw new Error(`${where}：defaults 必须是对象`);
  for (const [k, v] of Object.entries(def.defaults ?? {})) {
    if (typeof v !== 'function' && !(k === 'collect' && isPlainObject(v))) {
      throw new Error(`${where}：defaults.${k} 必须是 (options) => … 的工厂函数`);
    }
  }
  const entry = { type, dir, def };
  cache.set(type, entry);
  return entry;
}

const realOrSelf = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const within = (root, p) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

// { from: './x' } 引用读取器：相对阶段目录，readFrom 按 utf8 读入、readBinaryFrom（P3）读成 Buffer；两者共用单文件与合计 ≤ FROM_MAX_BYTES；
// 解析后的真实路径（跟随符号链接）必须在阶段根目录（lesson.config.stagesDir）内——课程根的 .env、data/ 等不在其中；
// 课程共用的文件放阶段根目录的子目录（如 stages/_shared/）
function createReaders(stageDir, stagesRoot) {
  let total = 0;
  const root = realOrSelf(stagesRoot);
  const read = (ref, encoding) => {
    const rel = typeof ref === 'string' ? ref : (isPlainObject(ref) && typeof ref.from === 'string' ? ref.from : null);
    if (!rel) throw new Error(`文件引用必须是 { from: '相对路径' }（得到 ${JSON.stringify(ref)}）`);
    const abs = path.resolve(stageDir, rel);
    if (!within(root, realOrSelf(abs))) {
      throw new Error(`${rel} 不在阶段根目录（${stagesRoot}）内（按真实路径判断，软链也算），只能引用阶段根目录里的文件；课程共用的文件放阶段根目录的子目录，如 _shared/`);
    }
    let size;
    try {
      size = fs.statSync(abs).size;
    } catch {
      throw new Error(`读取 ${rel} 失败：文件不存在（${abs}）`);
    }
    if (size > FROM_MAX_BYTES) throw new Error(`${rel} 有 ${kb(size)} KB，超过 ${kb(FROM_MAX_BYTES)} KB`);
    total += size;
    if (total > FROM_MAX_BYTES) throw new Error(`引用的文件合计 ${kb(total)} KB，超过 ${kb(FROM_MAX_BYTES)} KB（读到 ${rel} 时）`);
    try {
      return encoding ? fs.readFileSync(abs, encoding) : fs.readFileSync(abs);
    } catch (err) {
      throw new Error(`读取 ${rel} 失败：${err.message}`);
    }
  };
  return {
    readFrom: (ref) => read(ref, 'utf8'),
    readBinaryFrom: (ref) => read(ref, null),
  };
}

// P3：摘掉 $server（不改入参）；$server 不是对象时报错
export function splitServerOptions(options) {
  if (!isPlainObject(options) || !Object.hasOwn(options, SERVER_OPTIONS_KEY)) return { options, server: undefined };
  const { [SERVER_OPTIONS_KEY]: server, ...rest } = options;
  if (!isPlainObject(server)) throw new Error(`${SERVER_OPTIONS_KEY} 必须是对象（仅服务端选项，由 normalize 生成）`);
  return { options: rest, server };
}

// 任意深度里"只有一个 from 键"的对象替换为文件内容；其余原样（返回新树，不改阶段模块里的对象）
function resolveFromRefs(value, readFrom) {
  if (Array.isArray(value)) return value.map((v) => resolveFromRefs(v, readFrom));
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === 'from' && typeof value.from === 'string') return readFrom(value);
    return Object.fromEntries(keys.map((k) => [k, resolveFromRefs(value[k], readFrom)]));
  }
  return value;
}

function chainHooks(first, second) {
  if (!first) return second;
  if (!second) return first;
  return async function chained(...args) {
    await first(...args);
    return second(...args);
  };
}

// 按规格 §2.3 合并：原语 defaults(options) + 阶段 config → 有效 config
// primitive = { type, def }（def 为 primitive.config.js 默认导出）；options 为校验后的对象，可含 $server（P3）：
//   工厂拿完整 options，有效 config 的 options 去掉 $server
export function mergePrimitiveConfig(stageConfig, primitive, options) {
  const id = stageConfig.id;
  const type = primitive.type;
  const d = primitive.def.defaults ?? {};
  const publicOptions = splitServerOptions(options).options;
  const make = (key) => {
    const f = d[key];
    if (f === undefined) return undefined;
    if (key === 'collect' && isPlainObject(f)) return f;
    return f(options);
  };
  for (const key of STAGE_FIXED) {
    if (stageConfig[key] !== undefined) {
      throw new Error(`阶段"${id}"：使用原语"${type}"时不能写 ${key}（由原语决定；需要不同的 ${key} 就不用这个原语）`);
    }
  }
  const eff = { ...stageConfig, primitive: type, options: publicOptions };
  eff.layout = primitive.def.layout ?? 'focus';
  // P5：原语可给回看可交互的缺省（code / data-analysis 为 true），阶段写了以阶段为准
  if (stageConfig.reviewInteractive === undefined && primitive.def.reviewInteractive !== undefined) {
    eff.reviewInteractive = primitive.def.reviewInteractive;
  }
  const collect = make('collect');
  if (collect !== undefined) eff.collect = collect;
  const subPhases = make('subPhases');
  if (subPhases !== undefined && subPhases !== null) eff.subPhases = subPhases;
  // P2 预留：原语的 sandbox 配置（code / data-analysis）；原语提供时阶段不能再写，经 classroom:state 下发给前端
  const sandbox = make('sandbox');
  if (sandbox !== undefined) {
    if (stageConfig.sandbox !== undefined) {
      throw new Error(`阶段"${id}"：使用原语"${type}"时不能写 sandbox（由原语按 options 生成）`);
    }
    eff.sandbox = sandbox;
  }

  const primAlerts = make('alerts') ?? [];
  const stageAlerts = stageConfig.alerts ?? [];
  if (!Array.isArray(primAlerts)) throw new Error(`原语"${type}"：defaults.alerts(options) 必须返回数组`);
  if (!Array.isArray(stageAlerts)) throw new Error(`阶段"${id}"：alerts 必须是数组`);
  const primIds = new Set(primAlerts.map((a) => a && a.id));
  for (const a of stageAlerts) {
    if (a && primIds.has(a.id)) throw new Error(`阶段"${id}"：提醒 id "${a.id}" 与原语"${type}"的提醒重复`);
  }
  if (primAlerts.length + stageAlerts.length > 0) eff.alerts = [...primAlerts, ...stageAlerts];

  for (const key of HOOK_OVERRIDE) {
    const fn = stageConfig[key] ?? make(key);
    if (fn !== undefined) eff[key] = fn;
  }
  for (const key of HOOK_CHAIN) {
    const fn = chainHooks(make(key), stageConfig[key]);
    if (fn !== undefined) eff[key] = fn;
  }
  for (const key of [...HOOK_OVERRIDE, ...HOOK_CHAIN]) {
    if (eff[key] !== undefined && typeof eff[key] !== 'function') {
      throw new Error(`原语"${type}"：defaults.${key}(options) 必须返回函数`);
    }
  }
  if (eff.subPhases !== undefined && !(Array.isArray(eff.subPhases) && eff.subPhases.every((x) => typeof x === 'string'))) {
    throw new Error(`原语"${type}"：defaults.subPhases(options) 必须返回字符串数组或 undefined`);
  }
  return eff;
}

// 读 { from }、normalize（可 async）、摘出 $server、校验、限长 → { options: 校验后的公开 options, full: 含 $server 的完整 options }
async function resolvePrimitiveOptions(stageConfig, primitive, stageDir, stagesRoot) {
  const raw = stageConfig.options ?? {};
  if (!isPlainObject(raw)) throw new Error('options 必须是对象');
  if (Object.hasOwn(raw, SERVER_OPTIONS_KEY)) throw new Error(`${SERVER_OPTIONS_KEY} 由原语生成，不能在 stage.config.js 里写`);
  const { readFrom, readBinaryFrom } = createReaders(stageDir, stagesRoot);
  let options = resolveFromRefs(raw, readFrom);
  if (primitive.def.normalize) {
    const out = await primitive.def.normalize(options, { stageDir, readFrom, readBinaryFrom });
    if (out !== undefined) options = out;
  }
  const split = splitServerOptions(options);
  options = split.options;
  const validated = primitive.def.options(options);
  if (validated !== undefined) options = validated;
  if (isPlainObject(options) && Object.hasOwn(options, SERVER_OPTIONS_KEY)) throw new Error(`options 校验函数不能返回 ${SERVER_OPTIONS_KEY}`);
  const bytes = Buffer.byteLength(JSON.stringify(options) ?? '', 'utf8');
  if (bytes > OPTIONS_MAX_BYTES) throw new Error(`options 序列化后 ${kb(bytes)} KB，超过 ${kb(OPTIONS_MAX_BYTES)} KB`);
  const full = split.server === undefined ? options : { ...options, [SERVER_OPTIONS_KEY]: split.server };
  return { options, full };
}

// S5：原语加载（含 defaults 形状校验）、options 解析、合并（含工厂调用）抛的错统一带 阶段"<id>"： 前缀
async function resolvePrimitiveStage({ config, dir, stagesRoot, openComponents, primitivesRoot, cache }) {
  const id = config.id;
  const type = config.primitive;
  const prefix = `阶段"${id}"：`;
  try {
    const primitive = await loadPrimitive(type, primitivesRoot, cache);
    if (!primitive) throw new Error(`原语"${type}"不存在`);
    for (const cid of primitive.def.requiresComponents ?? []) {
      if (!openComponents.includes(cid)) throw new Error(`原语"${type}"需要打开组件"${cid}"`);
    }
    const { full } = await resolvePrimitiveOptions(config, primitive, dir, stagesRoot);
    return { config: mergePrimitiveConfig(config, primitive, full), primitive, serverOptions: full };
  } catch (err) {
    const msg = err?.message ?? String(err);
    throw new Error(msg.startsWith(prefix) ? msg : `${prefix}${msg}`);
  }
}

export async function loadLesson(configPath, { primitivesRoot = DEFAULT_PRIMITIVES_ROOT } = {}) {
  const absConfig = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(absConfig)) throw new Error(`lesson config not found: ${absConfig}`);
  const lessonConfig = await importDefault(absConfig);
  if (!lessonConfig || typeof lessonConfig !== 'object') throw new Error(`lesson config must export default an object: ${absConfig}`);
  // 名单与数据以课程为主体规格 §2.1：id 决定这门课的库（data/lessons/<id>.sqlite），必填且合法
  const idErr = lessonIdError(lessonConfig.id);
  if (idErr) throw new Error(idErr);
  if (!Array.isArray(lessonConfig.stages)) throw new Error('lesson config: stages must be an array of directory names');

  const stagesRoot = path.resolve(path.dirname(absConfig), lessonConfig.stagesDir ?? './stages');
  const stages = [];
  const seen = new Map();
  const openComponents = componentIdsOf(lessonConfig);
  const cache = new Map();
  for (const dirName of lessonConfig.stages) {
    if (typeof dirName !== 'string' || !dirName) throw new Error(`lesson config: invalid stage dir ${JSON.stringify(dirName)}`);
    const dir = path.join(stagesRoot, dirName);
    const cfgFile = path.join(dir, 'stage.config.js');
    if (!fs.existsSync(cfgFile)) throw new Error(`stage "${dirName}": missing stage.config.js (${cfgFile})`);
    const rawConfig = await importDefault(cfgFile);
    validateStageConfig(dirName, rawConfig, seen, openComponents);
    let config = rawConfig;
    let primitiveDir = null;
    let secretOptions = [];
    let serverOptions = null;
    if (rawConfig.primitive != null) {
      const r = await resolvePrimitiveStage({
        config: rawConfig, dir, stagesRoot, openComponents, primitivesRoot, cache,
      });
      config = r.config;
      primitiveDir = r.primitive.dir;
      secretOptions = r.primitive.def.secretOptions ?? [];
      serverOptions = r.serverOptions;
    } else {
      // v0.8：server.js 只在 primitive 为 null 时必需
      if (!fs.existsSync(path.join(dir, 'server.js'))) throw new Error(`stage "${dirName}": missing server.js`);
      // S5：options 只对原语阶段有意义，写了也不生效，提醒一句
      if (rawConfig.options !== undefined) {
        console.warn(`阶段"${rawConfig.id}"：primitive 为 null，options 不会生效（只有使用原语的阶段读 options）`);
      }
    }
    seen.set(config.id, dirName);
    // T9a（教师视图与学生页重排规格 §2.2）：演示视图恒有（缺省是该段学生页；阶段目录自带旧式 TeacherDemo.jsx 时渲染它），hasDemo 恒为真
    const hasDemo = true;
    stages.push({ id: config.id, dir, config, hasDemo, primitiveDir, secretOptions, serverOptions });
  }
  return { lessonConfig, stagesRoot, stages, stagesHash: stagesHash(stages.map((s) => s.id)) };
}

async function importRegister(file, who) {
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.register !== 'function') throw new Error(`${who}: server.js must export function register(ctx)`);
  return mod.register;
}

// v0.8：原语阶段返回组合的 register(ctx)：先原语 register(ctx, options)，再阶段自己的 register(ctx)（有则）；
// P3：原语 register 拿含 $server 的完整 options（stages[i].serverOptions；手工构造的 stage 没有时退回 config.options）；
// 同名事件由 ctx.on 的 "already registered" 拦住
export async function loadStageServers(stages) {
  const map = new Map();
  for (const s of stages) {
    const stageFile = path.join(s.dir, 'server.js');
    if (!s.primitiveDir) {
      map.set(s.id, await importRegister(stageFile, `stage "${s.id}"`));
      continue;
    }
    const primFile = path.join(s.primitiveDir, 'server.js');
    const primRegister = fs.existsSync(primFile) ? await importRegister(primFile, `原语"${s.config.primitive}"`) : null;
    const stageRegister = fs.existsSync(stageFile) ? await importRegister(stageFile, `stage "${s.id}"`) : null;
    const options = s.serverOptions ?? s.config.options;
    map.set(s.id, function registerPrimitiveStage(ctx) {
      if (primRegister) primRegister(ctx, options);
      if (stageRegister) stageRegister(ctx);
    });
  }
  return map;
}
