// .env 读写（管理台规格 §3）：工作台是 .env 的唯一编辑者；服务端仍用 dotenv 读取
//   readEnv(root) → { values, exists }
//   writeEnv(root, patch)：逐行读取；已知键原位替换值（重复出现的键每一处都替换），缺失的已知键追加到末尾，其余行原样保留；未知键忽略
//   ensureEnv(root, platform?)：.env 缺失时从 .env.example 生成（PORT：darwin / win32 取 80，linux 等取 3001；S14：TEACHER_PASSWORD 空时写默认 123456）；
//     G3（管理台线性路径重设计规格 §2.4）：LESSON_CONFIG 取 lessons/ 下第一门课（目录名排序），没有则留空（= 还没有课程）；
//     示例课 examples/ 只是给 AI 照抄的范本，不再默认
//   effectiveEnv：.env 里写了 LESSON_CONFIG=（空值）就是"还没有课程"，不回落到根目录配置；没有这一行仍按缺省
//   maskSecret / settingsView / prepareSettingsPatch / validateSettings：上课准备页的读出与提交
//   R3：RUNTIME_ZIP_URL（"平台"页"下载源（高级）"）；downloadEnv(root) = 下载子进程的环境（.env 里非空的 DOWNLOAD_KEYS 盖上去）；
//     platformEnv(root) = 去掉 DOWNLOAD_KEYS 的有效配置（process.js 判断"有改动未生效"用）
//   S14（默认教师密码规格 §1）：DEFAULT_PASSWORD = '123456'；fillDefaultPassword(root, log) → .env 存在且密码为空时补成默认并记一行日志（返回是否补了）；
//     passwordState(pw) → 'default'（为空或等于默认）| 'set'（overview.setup.password）
//   M6（名单与数据以课程为主体规格 §2.1）：DB_PATH 不再有缺省（每门课 data/lessons/<id>.sqlite）；.env 里 DB_PATH 等于旧缺省
//     data/classroom.sqlite 视为没设置（effectiveEnv 不带它；writeEnv 顺手删掉那一行）；其它显式值仍尊重：customDbPath(root) → 那个值或 null
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { isOldDefaultDbPath } from '../../kernel/server/lesson-db-path.js';

export const KNOWN_KEYS = [
  'PORT', 'DB_PATH', 'TEACHER_PASSWORD', 'AUTH_TOKEN_FILE', 'LESSON_CONFIG', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'RUNTIME_ZIP_URL',
  'AI_BASE_URL_2', 'AI_API_KEY_2', 'AI_MODEL_2',
];
// 上课准备页可见、可改的键（DB_PATH / AUTH_TOKEN_FILE 保持 .env.example 默认，不展示）
export const EDITABLE_KEYS = [
  'TEACHER_PASSWORD', 'PORT', 'LESSON_CONFIG', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'RUNTIME_ZIP_URL', 'AI_BASE_URL_2', 'AI_API_KEY_2', 'AI_MODEL_2',
];
// 上课准备页脱敏显示的密钥（K8：第二组备用接口的密钥同样处理）
export const SECRET_KEYS = ['AI_API_KEY', 'AI_API_KEY_2'];
// 下载 Python 运行时用的键（国内镜像与 Gitee 同步规格 §4）：工作台起下载子进程时从 .env 传入；平台本身不用，改了不需要重启平台
export const DOWNLOAD_KEYS = ['RUNTIME_ZIP_URL', 'PYODIDE_MIRROR', 'PYPI_MIRROR', 'FONT_URL'];
export const DEFAULTS = {
  PORT: '80',
  AUTH_TOKEN_FILE: 'data/teacher_tokens.json',
  LESSON_CONFIG: './lesson.config.js',
};
export const MASK = '••••';
export const DEFAULT_PASSWORD = '123456';

export const passwordState = (pw) => (!pw || pw === DEFAULT_PASSWORD ? 'default' : 'set');

const envFile = (root) => path.join(root, '.env');

export function readEnv(root) {
  const file = envFile(root);
  if (!fs.existsSync(file)) return { values: {}, exists: false };
  return { values: dotenv.parse(fs.readFileSync(file, 'utf8')), exists: true };
}

// 带默认值的有效配置（与 kernel/server/index.js 的缺省一致）
export function effectiveEnv(root) {
  const { values } = readEnv(root);
  const out = { ...values };
  if (!out.DB_PATH || isOldDefaultDbPath(out.DB_PATH)) delete out.DB_PATH;
  for (const [k, v] of Object.entries(DEFAULTS)) {
    // G3：LESSON_CONFIG 显式写成空值 = 还没有课程（不回落到根目录配置）
    if (k === 'LESSON_CONFIG' && out[k] === '') continue;
    if (!out[k]) out[k] = v;
  }
  return out;
}

// .env 里显式的、不是旧缺省的 DB_PATH（开发与测试用）；没有则 null（按课程分库）
export function customDbPath(root) {
  return effectiveEnv(root).DB_PATH ?? null;
}

// 下载子进程的环境：base（工作台自己的环境）+ .env 里非空的 DOWNLOAD_KEYS（.env 优先）
export function downloadEnv(root, base = process.env) {
  const { values } = readEnv(root);
  const out = { ...base };
  for (const k of DOWNLOAD_KEYS) {
    const v = String(values[k] ?? '').trim();
    if (v) out[k] = v;
  }
  return out;
}

// 平台关心的配置（判断"有改动未生效"用）：去掉只影响下载的键
export function platformEnv(root) {
  const out = effectiveEnv(root);
  for (const k of DOWNLOAD_KEYS) delete out[k];
  return out;
}

// 值 → .env 里的写法：必要时用引号包裹，保证 dotenv.parse 读回原值
export function formatValue(value) {
  const v = String(value ?? '');
  if (/[\r\n]/.test(v)) throw new Error('值不能包含换行');
  if (v === '') return '';
  const needsQuote = /[\s#"'`\\]/.test(v);
  if (!needsQuote) return v;
  // 双引号里 dotenv 会把 \n / \r 展开，含这种写法或含双引号时改用单引号 / 反引号
  if (!v.includes('"') && !/\\[nr]/.test(v)) return `"${v}"`;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('`')) return `\`${v}\``;
  throw new Error('值不能同时包含双引号、单引号和反引号');
}

const lineKey = (line) => {
  const m = /^\s*(?:export\s+)?([\w.-]+)\s*=/.exec(line);
  return m ? m[1] : null;
};

export function writeEnv(root, patch) {
  const file = envFile(root);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const entries = Object.entries(patch || {}).filter(([k, v]) => KNOWN_KEYS.includes(k) && v !== undefined && v !== null);
  const pending = new Map(entries.map(([k, v]) => [k, formatValue(v)]));
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const trailing = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailing) lines.pop();
  const written = new Set();
  // M6：旧缺省 DB_PATH=data/classroom.sqlite 那一行顺手删掉（按课程分库后它没有意义）
  const kept = lines.filter((line) => !(lineKey(line) === 'DB_PATH' && isOldDefaultDbPath(dotenv.parse(line).DB_PATH)));
  const out = kept.map((line) => {
    const key = lineKey(line);
    if (key && pending.has(key)) {
      written.add(key);
      return `${key}=${pending.get(key)}`;
    }
    return line;
  });
  for (const [k, v] of pending) if (!written.has(k)) out.push(`${k}=${v}`);
  fs.writeFileSync(file, out.length ? out.join(eol) + eol : '');
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // win32 或无权限时忽略
  }
}

export function ensureEnv(root, platform = process.platform) {
  if (fs.existsSync(envFile(root))) return { created: false };
  const example = path.join(root, '.env.example');
  const text = fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : '';
  fs.writeFileSync(envFile(root), text);
  const patch = { PORT: platform === 'win32' || platform === 'darwin' ? '80' : '3001' };
  if (!dotenv.parse(text).TEACHER_PASSWORD) patch.TEACHER_PASSWORD = DEFAULT_PASSWORD;
  // G3：新装默认课程 = lessons/ 下第一门；没有就留空（还没有课程）。不用示例课，也不用根目录的开发者配置
  const lesson = defaultLessonPath(root);
  patch.LESSON_CONFIG = lesson ?? '';
  writeEnv(root, patch);
  return { created: true, lesson: lesson || null };
}

// S14：已装过、.env 里密码为空 → 一次性补成默认 123456（工作台启动时在 ensureEnv 之后调用）
export function fillDefaultPassword(root, log = console.log) {
  const { values, exists } = readEnv(root);
  if (!exists || values.TEACHER_PASSWORD) return false;
  writeEnv(root, { TEACHER_PASSWORD: DEFAULT_PASSWORD });
  log(`教师密码为空，已设为默认 ${DEFAULT_PASSWORD}`);
  return true;
}

export function defaultLessonPath(root) {
  const dir = path.join(root, 'lessons');
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return null;
  }
  const withConfig = names.filter((n) => fs.existsSync(path.join(dir, n, 'lesson.config.js')));
  if (withConfig.length === 0) return null;
  return `./lessons/${withConfig[0]}/lesson.config.js`;
}

export function maskSecret(v) {
  const s = String(v ?? '');
  if (!s) return '';
  return s.length > 4 ? MASK + s.slice(-4) : MASK;
}

// GET /api/settings 的 values：只含可见键，API Key 脱敏
export function settingsView(values) {
  const out = {};
  for (const k of EDITABLE_KEYS) out[k] = values[k] ?? '';
  for (const k of SECRET_KEYS) out[k] = maskSecret(values[k]);
  return out;
}

// PUT 提交 → 待写入的 patch：值转字符串；AI_API_KEY / AI_API_KEY_2 缺省 / null / 脱敏值表示不改，"" 表示清空
export function prepareSettingsPatch(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (v === undefined || v === null) continue;
    if (SECRET_KEYS.includes(k) && typeof v === 'string' && v.startsWith(MASK)) continue;
    out[k] = typeof v === 'number' ? String(v) : v;
  }
  return out;
}

// 校验（规格 §3 表）；lessonPaths 给出时 LESSON_CONFIG 非空值须在其中（G3：空值 = 还没有课程，允许）
export function validateSettings(patch, { lessonPaths } = {}) {
  const errors = {};
  for (const [k, raw] of Object.entries(patch || {})) {
    if (!EDITABLE_KEYS.includes(k)) {
      errors[k] = '这一项不能在这里修改';
      continue;
    }
    if (typeof raw !== 'string' && !(k === 'PORT' && typeof raw === 'number')) {
      errors[k] = '格式不对';
      continue;
    }
    const v = String(raw);
    if (/[\r\n]/.test(v)) {
      errors[k] = '不能包含换行';
      continue;
    }
    try {
      formatValue(v);
    } catch {
      errors[k] = '这个值里的引号组合无法保存，请去掉其中的引号或反斜杠';
      continue;
    }
    if (k === 'TEACHER_PASSWORD') {
      if (v.length === 0) errors[k] = '密码不能为空';
      else if (v.length < 6) errors[k] = '密码至少 6 位';
      else if (v.length > 64) errors[k] = '密码不能超过 64 个字符';
    } else if (k === 'PORT') {
      const n = Number(v);
      if (!/^\d+$/.test(v.trim()) || !Number.isInteger(n) || n < 1 || n > 65535) errors[k] = '端口须是 1 到 65535 之间的整数';
    } else if (k === 'AI_BASE_URL' || k === 'AI_BASE_URL_2') {
      if (v !== '' && !/^https?:\/\//i.test(v)) errors[k] = '地址须以 http:// 或 https:// 开头';
    } else if (k === 'RUNTIME_ZIP_URL') {
      if (v !== '' && !/^https?:\/\/\S+$/i.test(v)) errors[k] = '地址须以 http:// 或 https:// 开头，中间不能有空格';
    } else if (k === 'LESSON_CONFIG') {
      if (v !== '' && lessonPaths && !lessonPaths.includes(v)) errors[k] = '找不到这门课程';
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
