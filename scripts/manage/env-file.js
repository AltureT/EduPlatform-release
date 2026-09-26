// .env 读写（管理台规格 §3）：管理台是 .env 的唯一编辑者；服务端仍用 dotenv 读取
//   readEnv(root) → { values, exists }
//   writeEnv(root, patch)：逐行读取；已知键原位替换值（重复出现的键每一处都替换），缺失的已知键追加到末尾，其余行原样保留；未知键忽略
//   ensureEnv(root, platform?)：.env 缺失时从 .env.example 生成（PORT：darwin / win32 取 80，linux 等取 3001；LESSON_CONFIG 取 examples/ 下第一门课，minimal 优先）
//   maskSecret / settingsView / prepareSettingsPatch / validateSettings：设置页的读出与提交
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export const KNOWN_KEYS = [
  'PORT', 'DB_PATH', 'TEACHER_PASSWORD', 'AUTH_TOKEN_FILE', 'LESSON_CONFIG', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL',
];
// 设置页可见、可改的键（DB_PATH / AUTH_TOKEN_FILE 保持 .env.example 默认，不展示）
export const EDITABLE_KEYS = ['TEACHER_PASSWORD', 'PORT', 'LESSON_CONFIG', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'];
export const DEFAULTS = {
  PORT: '80',
  DB_PATH: 'data/classroom.sqlite',
  AUTH_TOKEN_FILE: 'data/teacher_tokens.json',
  LESSON_CONFIG: './lesson.config.js',
};
const MASK = '••••';

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
  for (const [k, v] of Object.entries(DEFAULTS)) if (!out[k]) out[k] = v;
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
  const out = lines.map((line) => {
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
  // 新装默认课程：examples/ 下第一门（minimal 优先，不需要 Python 运行时），不用根目录的开发者配置
  const lesson = defaultLessonPath(root);
  if (lesson) patch.LESSON_CONFIG = lesson;
  writeEnv(root, patch);
  return { created: true, lesson: lesson || null };
}

export function defaultLessonPath(root) {
  const dir = path.join(root, 'examples');
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return null;
  }
  const withConfig = names.filter((n) => fs.existsSync(path.join(dir, n, 'lesson.config.js')));
  if (withConfig.length === 0) return null;
  const pick = withConfig.includes('minimal') ? 'minimal' : withConfig[0];
  return `./examples/${pick}/lesson.config.js`;
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
  out.AI_API_KEY = maskSecret(values.AI_API_KEY);
  return out;
}

// PUT 提交 → 待写入的 patch：值转字符串；AI_API_KEY 缺省 / null / 脱敏值表示不改，"" 表示清空
export function prepareSettingsPatch(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (v === undefined || v === null) continue;
    if (k === 'AI_API_KEY' && typeof v === 'string' && v.startsWith(MASK)) continue;
    out[k] = typeof v === 'number' ? String(v) : v;
  }
  return out;
}

// 校验（规格 §3 表）；lessonPaths 给出时 LESSON_CONFIG 须在其中
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
    } else if (k === 'AI_BASE_URL') {
      if (v !== '' && !/^https?:\/\//i.test(v)) errors[k] = '地址须以 http:// 或 https:// 开头';
    } else if (k === 'LESSON_CONFIG') {
      if (v === '') errors[k] = '请选择课程';
      else if (lessonPaths && !lessonPaths.includes(v)) errors[k] = '找不到这门课程';
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
