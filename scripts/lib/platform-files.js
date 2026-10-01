// 平台文件改动检查（框架自描述规格 §4）：发布包 版本.json 的 protected 清单（相对路径 → sha256）与本机文件比对。
//   打包（仓库根 scripts/pack-release.mjs）：protectedManifest(templateDir, 打包文件清单) 写进 版本.json 的 protected
//   检查（check:lesson 第 12 项、管理台"平台"页）：checkPlatformFiles(平台目录) →
//     { checked: false, reason, version }（没有 版本.json / 没有 protected / 读不出，开发仓库即如此）
//     { checked: true, version, builtAt, total, modified, missing, added, changes }（三个数组都是排好序的相对路径）
//   受保护 = kernel/ components/ primitives/ scripts/ docs/ skills/ 下的文件 + index.html vite.config.js package.json + 各 AI 工具入口文件；
//   不含 examples/、lessons/、README.md。"多出"只在六个受保护目录里找（系统自动生成的 .DS_Store 等不算）。
//   比对时容忍换行符：哈希不符、但把 CRLF 换成 LF 后相符的算完好（Windows 上 git 检出发布仓库会改行尾）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AI_ENTRY_PATHS } from './ai-entry.js';

export const VERSION_FILE = '版本.json';
export const PROTECTED_DIRS = ['kernel/', 'components/', 'primitives/', 'scripts/', 'docs/', 'skills/'];
export const PROTECTED_FILES = ['index.html', 'vite.config.js', 'package.json', ...AI_ENTRY_PATHS];
// 系统或工具自动生成、不算"多出"的文件与目录
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const IGNORED_DIRS = new Set(['node_modules', '__pycache__']);

const toPosix = (p) => p.split(path.sep).join('/');

export function isProtected(rel) {
  const p = toPosix(rel);
  return PROTECTED_FILES.includes(p) || PROTECTED_DIRS.some((d) => p.startsWith(d));
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function sha256File(abs) {
  return sha256(fs.readFileSync(abs));
}

// files：相对 root 的路径（打包清单）；只收受保护的，键排好序
export function protectedManifest(root, files) {
  const out = {};
  for (const rel of [...files].map(toPosix).filter(isProtected).sort()) out[rel] = sha256File(path.join(root, rel));
  return out;
}

export function readVersionInfo(root) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(root, VERSION_FILE), 'utf8'));
    return info && typeof info === 'object' && !Array.isArray(info) ? info : null;
  } catch {
    return null;
  }
}

// 与清单相符：原样哈希相等，或 CRLF → LF 后相等
function sameContent(abs, want) {
  const buf = fs.readFileSync(abs);
  if (sha256(buf) === want) return true;
  if (!buf.includes('\r\n')) return false;
  return sha256(Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')) === want;
}

function walk(root, dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = `${dir}${e.name}`;
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) walk(root, `${rel}/`, out);
    } else if (!IGNORED_FILES.has(e.name) && !e.name.startsWith('._')) {
      out.push(rel);
    }
  }
}

export function checkPlatformFiles(root) {
  const info = readVersionInfo(root);
  if (!info) return { checked: false, reason: fs.existsSync(path.join(root, VERSION_FILE)) ? 'unreadable' : 'no-version', version: null };
  const version = typeof info.version === 'string' ? info.version : null;
  const list = info.protected;
  if (!list || typeof list !== 'object' || Array.isArray(list) || Object.keys(list).length === 0) {
    return { checked: false, reason: 'no-protected', version };
  }
  const modified = [];
  const missing = [];
  for (const [rel, want] of Object.entries(list)) {
    const abs = path.join(root, rel);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      missing.push(rel);
      continue;
    }
    try {
      if (!st.isFile() || !sameContent(abs, want)) modified.push(rel);
    } catch {
      modified.push(rel);
    }
  }
  const present = [];
  for (const d of PROTECTED_DIRS) walk(root, d, present);
  const added = present.filter((rel) => !Object.hasOwn(list, rel));
  const sort = (a) => a.sort();
  return {
    checked: true,
    version,
    builtAt: typeof info.builtAt === 'string' ? info.builtAt : null,
    total: Object.keys(list).length,
    modified: sort(modified),
    missing: sort(missing),
    added: sort(added),
    changes: modified.length + missing.length + added.length,
  };
}

// check:lesson 的警告文字（规格 §4）；没有改动返回 null
export function platformFilesWarning(r) {
  if (!r?.checked || r.changes === 0) return null;
  const all = [...r.modified, ...r.missing, ...r.added];
  const parts = [
    r.modified.length ? `改动 ${r.modified.length} 个` : null,
    r.missing.length ? `缺失 ${r.missing.length} 个` : null,
    r.added.length ? `多出 ${r.added.length} 个` : null,
  ].filter(Boolean).join('、');
  const head = all.length > 1 ? `${all[0]} 等 ${all.length} 个` : all[0];
  return {
    first: all[0],
    message: `平台文件被改过：${head}（${parts}）。升级时会被覆盖；做课的改动应放在 lessons/<id>/ 下`,
    fix: '把需要的改动挪回课程目录；要恢复平台文件请重新解压发布包覆盖这些目录（lessons、data、.env 不会丢）',
  };
}
