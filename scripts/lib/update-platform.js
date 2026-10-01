// 平台更新（管理台更新规格 §2 检查、§3 更新）：纯函数 + 流程；scripts/update-platform.mjs 只是命令行壳，管理台 server.js 用检查部分
//   RELEASE_API：Gitee → GitHub 的发布列表接口（两边都混着 runtime-v… 的 tag，所以不用 /releases/latest，自己挑）
//   pickLatest(releases, current) → { tag, version, url, size?, publishedAt? } | null：tag 是 vX.Y.Z、不是预发布 / 草稿、
//     资源里有名字正好是 EduPlatform-v<版本>.zip 的，取版本最大的；不比 current 新 → null
//   currentVersion(root) → { current, dev }：版本.json 的 version；没有 版本.json = 开发版（取 package.json 的 version，dev: true）
//   checkUpdate({ root, fetch, sources?, timeoutMs?, now? }) → { current, dev, latest, checkedAt, error? }：
//     按序查，每个来源 timeoutMs（默认 10 s），一个成功就停；latest 带 source（Gitee / GitHub）与 urls（查到的下载地址）
//   validatePackage(buf, version, { maxTotal?, maxEntries? }) → { top, files: Map<相对路径, Buffer>, info }：
//     唯一顶层目录、剥掉后无越界路径、版本.json 的 version 相符、protected 每项都在且 sha256 相符；不符抛 code = 'BAD_PACKAGE'
//   applyUpdate({ root, zipFile, version, log, now, io?, afterWrite? }) → { code, backupDir?, message }：校验 → 备份 → 覆盖 → 验证，失败回滚
//   runUpdate({ root, version, urls, fetch?, log, now, beforeApply?, protocols? }) → 同上：先下载（只允许 https:，边下边卡 50 MB；
//     第一个地址失败换下一个）再 applyUpdate；beforeApply() 在开始校验 / 备份 / 覆盖之前调用（命令行壳在这里屏蔽 Ctrl+C / 关窗口信号）
//   备份目录的 manifest.json 带 done：写备份时 false，更新成功或回滚成功后 true；
//   recoverInterruptedUpdate(root, { log, isAlive? }) → null | { ok, action, from, to, backupDir, errors, pid? }：最新一个备份 done === false 时——
//     manifest 记的更新子进程 pid 还活着 → action 'running'，不动（ok: false）；
//     平台文件已完好（checkPlatformFiles 无改动 / 缺失，例如教师已重新解压覆盖）→ action 'intact'，只把 done 标 true；
//     否则按 manifest 回滚 → action 'rolled-back'（done 标 true）或 'failed'（ok: false，保留 done:false 下次再试）。
//     管理台启动时调用（管理台页面上方横幅提示"上次更新没有完成，已恢复到更新前"）；也可 node scripts/update-platform.mjs --recover 手动跑
//   退出码 EXIT：0 成功、1 参数或前置不对（没改文件）、2 下载失败、3 包不对、4 失败已回滚、5 回滚也失败
// 注意：本模块在 scripts/lib/ 里，更新时会被新版本覆盖。它 import 的模块（zip.js、runtime-zip.js → pyodide-fetch.js、platform-files.js）
//   全部是顶部的静态 import，进程启动时就已加载进内存；覆盖开始后不得再有动态 import（回滚也只用 node: 内置模块与已加载的函数）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readZip, entryData, safeName } from './zip.js';
import { downloadZip } from './runtime-zip.js';
import { checkPlatformFiles, readVersionInfo, VERSION_FILE } from './platform-files.js';

export const releaseZipName = (v) => `EduPlatform-v${v}.zip`;
// download(v)：该来源发布页上同名资源的固定地址（查到的那边在前，另一边拼出来作备用）
export const RELEASE_API = [
  {
    label: 'Gitee',
    url: 'https://gitee.com/api/v5/repos/alture/EduPlatform-release/releases?page=1&per_page=20',
    download: (v) => `https://gitee.com/alture/EduPlatform-release/releases/download/v${v}/${releaseZipName(v)}`,
  },
  {
    label: 'GitHub',
    url: 'https://api.github.com/repos/AltureT/EduPlatform-release/releases?per_page=20',
    download: (v) => `https://github.com/AltureT/EduPlatform-release/releases/download/v${v}/${releaseZipName(v)}`,
  },
];
export const CHECK_ERROR = '查不到新版本：网络不通或发布页打不开';
export const MAX_DOWNLOAD = 50e6;
export const MAX_UNPACKED = 100e6;
export const MAX_ENTRIES = 5000;
export const KEEP_BACKUPS = 3;
export const KEEP_ZIPS = 2;
export const UPDATES_DIR = 'backups/updates';
export const EXIT = { OK: 0, ERROR: 1, DOWNLOAD: 2, BAD_PACKAGE: 3, ROLLED_BACK: 4, ROLLBACK_FAILED: 5 };
// 包里有也不写、本机有也不删（末尾 / = 目录）
export const SKIP = ['lessons/', 'data/', 'backups/', 'vendor/', 'node_modules/', 'dist/', '.env', '.env.local', '.manage.lock', '.teacher-secret'];
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

// 大小写不敏感（Mac / Windows 默认文件系统）：Lessons/ 与 lessons/ 是同一个目录
export function isSkipped(rel) {
  rel = String(rel).toLowerCase();
  return SKIP.some((s) => (s.endsWith('/') ? rel === s.slice(0, -1) || rel.startsWith(s) : rel === s || rel.startsWith(`${s}/`)));
}

export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ''));
  return m ? m.slice(1, 4).map(Number) : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

// ===== §2 检查 =====
export function pickLatest(releases, current) {
  if (!Array.isArray(releases)) return null;
  const candidates = [];
  for (const r of releases) {
    const m = TAG_RE.exec(String(r?.tag_name ?? ''));
    if (!m || r.prerelease || r.draft) continue;
    const version = m.slice(1, 4).map(Number).join('.');
    const a = (Array.isArray(r.assets) ? r.assets : []).find((x) => x?.name === releaseZipName(version)
      && typeof x.browser_download_url === 'string' && x.browser_download_url.startsWith('https://'));
    if (!a) continue; // 找不到资源（Gitee 自动附的源码包名字不同）→ 这条不算
    const out = { tag: r.tag_name, version, url: a.browser_download_url };
    if (Number.isFinite(a.size) && a.size > 0) out.size = a.size;
    const at = r.published_at ?? r.created_at;
    if (typeof at === 'string' && at) out.publishedAt = at;
    candidates.push(out);
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  const best = candidates[0];
  if (!best || compareVersions(best.version, current) <= 0) return null;
  return best;
}

export function currentVersion(root) {
  const info = readVersionInfo(root);
  if (info && typeof info.version === 'string') return { current: info.version, dev: false };
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? null;
  } catch {
    // 读不出
  }
  return { current, dev: true };
}

async function fetchReleases(src, { fetch: fetchImpl, timeoutMs }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`${timeoutMs / 1000} 秒没连上`)), timeoutMs);
  try {
    const r = await fetchImpl(src.url, { signal: ac.signal, headers: { Accept: 'application/json', 'User-Agent': 'EduPlatform-manage' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body)) throw new Error('发布列表格式不对');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkUpdate({ root, fetch: fetchImpl = globalThis.fetch, sources = RELEASE_API, timeoutMs = 10_000, now = Date.now, warn = () => {} }) {
  const { current, dev } = currentVersion(root);
  for (const src of sources) {
    let releases;
    try {
      releases = await fetchReleases(src, { fetch: fetchImpl, timeoutMs });
    } catch (err) {
      warn(`[update] ${src.label} 没查到：${err?.message ?? err}`);
      continue;
    }
    const best = pickLatest(releases, current);
    const urls = best ? [...new Set([best.url, ...sources.filter((x) => x !== src && x.download).map((x) => x.download(best.version))])] : [];
    const latest = best ? { ...best, source: src.label, urls } : null;
    return { current, dev, latest, checkedAt: now() };
  }
  return { current, dev, latest: null, checkedAt: now(), error: CHECK_ERROR };
}

// ===== §3 第 2 步：校验包 =====
const badPackage = (message) => Object.assign(new Error(message), { code: 'BAD_PACKAGE' });
// Windows 写不出或有特殊含义的名字：含 :、控制字符（含 NUL），或某段（不看扩展名）是保留设备名
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export function unsafeRel(rel) {
  // eslint-disable-next-line no-control-regex
  if (/[:\x00-\x1f\x7f]/.test(rel)) return true;
  return rel.split('/').some((seg) => RESERVED.test(seg.split('.')[0].trim()));
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function validatePackage(buf, version, { maxTotal = MAX_UNPACKED, maxEntries = MAX_ENTRIES } = {}) {
  let entries;
  try {
    entries = readZip(buf);
  } catch (err) {
    throw badPackage(err?.message ?? String(err));
  }
  if (entries.length === 0) throw badPackage('包是空的');
  if (entries.length > maxEntries) throw badPackage(`包里的条目太多（${entries.length} 个，上限 ${maxEntries}）`);
  const top = entries[0].name.split('/')[0];
  if (!entries[0].name.includes('/')) throw badPackage('包里没有顶层目录');
  let total = 0;
  const byRel = new Map();
  for (const e of entries) {
    if (!e.name.startsWith(`${top}/`)) throw badPackage(`包里不止一个顶层目录：${e.name}`);
    const rel = e.name.slice(top.length + 1);
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) throw badPackage(`包里有越界路径：${e.name}`);
    if (unsafeRel(rel)) throw badPackage(`包里有 Windows 不允许的文件名：${e.name}`);
    total += e.size;
    if (total > maxTotal) throw badPackage(`包解压后超过 ${Math.round(maxTotal / 1e6)} MB`);
    byRel.set(rel, e);
  }
  const files = new Map();
  try {
    for (const [rel, e] of byRel) files.set(rel, entryData(buf, e));
  } catch (err) {
    throw badPackage(err?.message ?? String(err));
  }
  const vbuf = files.get(VERSION_FILE);
  if (!vbuf) throw badPackage(`包里没有 ${VERSION_FILE}`);
  let info;
  try {
    info = JSON.parse(vbuf.toString('utf8'));
  } catch {
    throw badPackage(`包里的 ${VERSION_FILE} 读不出`);
  }
  if (info?.version !== version) throw badPackage(`包是 ${info?.version ?? '未知'} 版，要的是 ${version}`);
  const prot = info.protected;
  if (!prot || typeof prot !== 'object' || Array.isArray(prot)) throw badPackage(`包里的 ${VERSION_FILE} 没有 protected 清单`);
  for (const [rel, want] of Object.entries(prot)) {
    const data = files.get(rel);
    if (!data) throw badPackage(`清单里的 ${rel} 不在包里`);
    if (sha256(data) !== want) throw badPackage(`${rel} 与清单的 sha256 不符`);
  }
  return { top, files, info };
}

// ===== 小工具 =====
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const abs = (root, rel) => path.join(root, ...rel.split('/'));

function isFile(f) {
  try {
    return fs.lstatSync(f).isFile();
  } catch {
    return false;
  }
}
function exists(f) {
  try {
    fs.lstatSync(f);
    return true;
  } catch {
    return false;
  }
}

// 删掉 rel 所在的空目录，一直往上到 root（不删 root）
function pruneEmptyDirs(root, rel) {
  let dir = path.dirname(abs(root, rel));
  const top = path.resolve(root);
  while (path.resolve(dir) !== top && path.resolve(dir).startsWith(top)) {
    try {
      if (fs.readdirSync(dir).length > 0) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

// dir 下名字匹配 re 的项，按 key 从新到旧，只留 keep 个（keepFirst 永远留）
function pruneOld(dir, re, key, keep, keepFirst = null) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => re.test(n));
  } catch {
    return;
  }
  const sorted = names.map((n) => ({ n, k: key(n) })).sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0)).map((x) => x.n);
  const ordered = keepFirst && sorted.includes(keepFirst) ? [keepFirst, ...sorted.filter((n) => n !== keepFirst)] : sorted;
  for (const n of ordered.slice(keep)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
}

// 本机旧 版本.json 的 protected 键先规范化（\ → /、去掉 ./）；越界或绝对路径的键丢掉不用
function normalizeProtected(prot) {
  const out = {};
  for (const [k, v] of Object.entries(prot)) {
    try {
      const n = safeName(k);
      if (n) out[n] = v;
    } catch {
      // 不认
    }
  }
  return out;
}

const depsOf = (pkg) => JSON.stringify(['dependencies', 'devDependencies', 'engines'].map((k) => pkg?.[k] ?? null));
function readJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

// ===== §3 第 6 步：回滚（只用 fs，不用注入的 io）=====
// 某个文件恢复不了（备份缺文件等）→ 记下继续恢复其余，最后一起抛
function rollback(root, backupAbs, manifest, log) {
  const errors = [];
  const attempt = (rel, fn) => {
    try {
      fn();
    } catch (err) {
      errors.push(`${rel}：${err?.code ?? err?.message ?? err}`);
    }
  };
  for (const rel of manifest.files) {
    attempt(rel, () => {
      const to = abs(root, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(abs(backupAbs, rel), to);
      const mode = manifest.modes?.[rel];
      if (mode && process.platform !== 'win32') fs.chmodSync(to, mode);
    });
  }
  for (const rel of manifest.added) {
    attempt(rel, () => {
      fs.rmSync(abs(root, rel), { force: true });
      fs.rmSync(`${abs(root, rel)}.updating`, { force: true });
      pruneEmptyDirs(root, rel);
    });
  }
  for (const rel of manifest.files) attempt(rel, () => fs.rmSync(`${abs(root, rel)}.updating`, { force: true }));
  const c = checkPlatformFiles(root);
  if (c.checked) log(`  恢复后检查：${c.version ?? '?'} 版，改动 ${c.modified.length}、缺失 ${c.missing.length}`);
  else log('  恢复后检查：读不到版本记录');
  if (errors.length) {
    throw new Error(`有 ${errors.length} 个文件没能恢复（${errors.slice(0, 3).join('；')}${errors.length > 3 ? '……' : ''}）`);
  }
}

function writeManifest(backupAbs, manifest) {
  const f = path.join(backupAbs, 'manifest.json');
  fs.writeFileSync(`${f}.part`, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(`${f}.part`, f);
}

const BACKUP_RE = /^before-v/;
const backupKey = (n) => /(\d{8}-\d{6}(?:-\d+)?)$/.exec(n)?.[1] ?? '';

// 管理台启动时：最新的备份 done === false → 覆盖中途被打断（Ctrl+C、关窗口、断电），按 manifest 回滚一次
// pid 是否还活着：signal 0 只检查不发信号（Windows 同样可用）；EPERM = 活着但不是我们的
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export function recoverInterruptedUpdate(root, { log = () => {}, isAlive = pidAlive } = {}) {
  const updates = path.join(root, ...UPDATES_DIR.split('/'));
  let names;
  try {
    names = fs.readdirSync(updates).filter((n) => BACKUP_RE.test(n));
  } catch {
    return null;
  }
  const latest = names.sort((a, b) => (backupKey(a) < backupKey(b) ? 1 : backupKey(a) > backupKey(b) ? -1 : 0))[0];
  if (!latest) return null;
  const backupAbs = path.join(updates, latest);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(backupAbs, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
  if (manifest?.done !== false || !Array.isArray(manifest.files) || !Array.isArray(manifest.added)) return null;
  const backupDir = `${UPDATES_DIR}/${latest}`;
  const base = { from: manifest.from, to: manifest.to, backupDir, errors: [] };
  if (isAlive(manifest.pid)) {
    log(`[update] 更新程序（进程 ${manifest.pid}）还在运行，先不恢复`);
    return { ...base, ok: false, action: 'running', pid: manifest.pid };
  }
  const c = checkPlatformFiles(root);
  if (c.checked && c.modified.length === 0 && c.missing.length === 0) {
    log(`[update] 上次更新没有标记完成，但平台文件已完好（${c.version ?? '?'} 版），只记下已完成`);
    writeManifest(backupAbs, { ...manifest, done: true, intactAt: new Date().toISOString(), intactVersion: c.version });
    return { ...base, ok: true, action: 'intact', version: c.version };
  }
  log(`[update] 上次更新（v${manifest.from} → v${manifest.to}）没有完成，正在恢复到更新前…`);
  try {
    rollback(root, backupAbs, manifest, log);
  } catch (err) {
    log(`[update] 恢复没有全部成功：${err?.message ?? err}；备份在 ${backupDir}`);
    return { ...base, ok: false, action: 'failed', errors: [String(err?.message ?? err)] };
  }
  writeManifest(backupAbs, { ...manifest, done: true, rolledBack: true, recoveredAt: new Date().toISOString() });
  return { ...base, ok: true, action: 'rolled-back' };
}

// ===== §3 第 3–7 步 =====
export function applyUpdate({
  root, zipFile, version, log = () => {}, now = new Date(), io = {}, afterWrite = null,
}) {
  const writeFile = io.writeFile ?? ((f, d) => fs.writeFileSync(f, d));
  const rename = io.rename ?? ((a, b) => fs.renameSync(a, b));
  const oldInfo = readVersionInfo(root);
  const rawProt = oldInfo?.protected;
  if (typeof oldInfo?.version !== 'string' || !rawProt || typeof rawProt !== 'object' || Array.isArray(rawProt)) {
    const message = '这是开发版（平台文件夹里没有版本记录），不能自动更新';
    log(message);
    return { code: EXIT.ERROR, message };
  }
  const oldProt = normalizeProtected(rawProt);

  // 第 2 步：校验包
  log('2/5 校验下载的包…');
  let pkg;
  try {
    pkg = validatePackage(fs.readFileSync(zipFile), version);
  } catch (err) {
    fs.rmSync(zipFile, { force: true });
    const message = '下载的包不完整或被改过';
    log(`${message}（${err?.message ?? err}）`);
    return { code: EXIT.BAD_PACKAGE, message };
  }
  const writes = [...pkg.files.keys()].filter((rel) => !isSkipped(rel));
  for (const rel of writes) {
    const f = abs(root, rel);
    if (exists(f) && !isFile(f)) {
      const message = `更新没有开始：平台文件夹里的 ${rel} 不是文件，请先挪走它`;
      log(message);
      return { code: EXIT.ERROR, message };
    }
  }

  // 第 3 步：备份
  log('3/5 备份要被替换的平台文件…');
  const updates = path.join(root, ...UPDATES_DIR.split('/'));
  let backupRel = `${UPDATES_DIR}/before-v${oldInfo.version}-${stamp(now)}`;
  for (let i = 2; exists(abs(root, backupRel)); i += 1) backupRel = `${UPDATES_DIR}/before-v${oldInfo.version}-${stamp(now)}-${i}`;
  const backupAbs = abs(root, backupRel);
  const manifest = { from: oldInfo.version, to: version, done: false, pid: process.pid, files: [], added: [], modes: {} };
  try {
    const save = (rel) => {
      const from = abs(root, rel);
      const to = abs(backupAbs, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      manifest.files.push(rel);
      if (process.platform !== 'win32') manifest.modes[rel] = fs.statSync(from).mode & 0o777;
    };
    const saved = new Set();
    for (const rel of [...Object.keys(oldProt).filter((r) => !isSkipped(r)), VERSION_FILE]) {
      if (saved.has(rel) || !isFile(abs(root, rel))) continue;
      save(rel);
      saved.add(rel);
    }
    for (const rel of writes) {
      if (saved.has(rel)) continue;
      if (isFile(abs(root, rel))) {
        save(rel);
        saved.add(rel);
      } else manifest.added.push(rel);
    }
    writeManifest(backupAbs, manifest);
  } catch (err) {
    fs.rmSync(backupAbs, { recursive: true, force: true });
    const message = '更新失败，已恢复到更新前';
    log(`${message}（备份时出错：${err?.message ?? err}；平台文件没有改动）`);
    return { code: EXIT.ROLLED_BACK, message };
  }
  pruneOld(updates, BACKUP_RE, backupKey, KEEP_BACKUPS, path.basename(backupAbs));
  log(`备份目录：${backupRel}`);

  // 第 4、5 步：覆盖 + 验证（失败回滚）
  const oldPkg = readJson(path.join(root, 'package.json'));
  try {
    log('4/5 写入新版本的文件…');
    const newProt = pkg.info.protected;
    for (const rel of Object.keys(oldProt)) {
      if (Object.hasOwn(newProt, rel) || pkg.files.has(rel) || isSkipped(rel)) continue;
      const f = abs(root, rel);
      if (!isFile(f)) continue;
      fs.rmSync(f);
      pruneEmptyDirs(root, rel);
    }
    for (const rel of writes) {
      const f = abs(root, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      writeFile(`${f}.updating`, pkg.files.get(rel));
      rename(`${f}.updating`, f);
      if (rel === '管理台.command' && process.platform !== 'win32') fs.chmodSync(f, 0o755);
    }
    afterWrite?.(root, { backupDir: backupRel });
    log('5/5 检查写入的文件…');
    const c = checkPlatformFiles(root);
    if (!c.checked || c.version !== version) throw new Error('写入后读不到新的版本记录');
    if (c.modified.length || c.missing.length) {
      throw new Error(`写入后有 ${c.modified.length + c.missing.length} 个文件对不上（${[...c.modified, ...c.missing].slice(0, 3).join('、')}）`);
    }
  } catch (err) {
    log(`  出错：${err?.message ?? err}`);
    log('正在恢复到更新前…');
    try {
      rollback(root, backupAbs, manifest, log);
    } catch (e2) {
      const message = '更新失败，恢复也没有成功';
      log(`${message}（${e2?.message ?? e2}）`);
      log(`更新前的文件备份在：${backupRel}`);
      log('请重新解压发布包覆盖平台文件夹（课程、课堂数据和设置不会丢）');
      return { code: EXIT.ROLLBACK_FAILED, backupDir: backupRel, message };
    }
    const message = '更新失败，已恢复到更新前';
    try {
      writeManifest(backupAbs, { ...manifest, done: true, rolledBack: true });
    } catch {
      // 标不上也无妨：下次启动再按同一份备份恢复一次，结果相同
    }
    log(message);
    log(`更新前的文件备份在：${backupRel}`);
    return { code: EXIT.ROLLED_BACK, backupDir: backupRel, message };
  }

  // 验证通过后：删 dist/（下次启动平台重新构建）；依赖有变化 → 删 .package-lock.json（入口脚本据此重新 npm install）
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  const newPkg = readJson(path.join(root, 'package.json'));
  if (depsOf(oldPkg) !== depsOf(newPkg)) {
    fs.rmSync(path.join(root, 'node_modules', '.package-lock.json'), { force: true });
    log('  依赖有变化：下次双击启动时会重新安装依赖');
  }
  pruneOld(updates, /^EduPlatform-v\d+\.\d+\.\d+\.zip$/, (n) => {
    try {
      return String(fs.statSync(path.join(updates, n)).mtimeMs).padStart(20, '0');
    } catch {
      return '';
    }
  }, KEEP_ZIPS, path.basename(zipFile));
  writeManifest(backupAbs, { ...manifest, done: true });
  const message = `已更新到 v${version}`;
  log(message);
  return { code: EXIT.OK, backupDir: backupRel, message };
}

// ===== 全流程：下载（第 1 步）+ applyUpdate =====
export async function runUpdate({
  root, version, urls, fetch: fetchImpl = globalThis.fetch, log = () => {}, now = new Date(), io, afterWrite, downloadOptions = {},
  beforeApply = () => {}, protocols = ['https:'],
}) {
  if (!parseVersion(version)) {
    log(`版本号不对：${version}`);
    return { code: EXIT.ERROR, message: '版本号不对' };
  }
  const bad = urls.filter((u) => {
    try {
      return !protocols.includes(new URL(u).protocol);
    } catch {
      return true;
    }
  });
  if (bad.length || urls.length === 0) {
    log(`下载地址不对（只允许 https）：${bad.join(' ') || '没有地址'}`);
    return { code: EXIT.ERROR, message: '下载地址不对' };
  }
  const updates = path.join(root, ...UPDATES_DIR.split('/'));
  fs.mkdirSync(updates, { recursive: true });
  const dest = path.join(updates, releaseZipName(version));
  log(`1/5 下载新版本 v${version}…`);
  let ok = false;
  for (const url of urls) {
    fs.rmSync(dest, { force: true });
    fs.rmSync(`${dest}.part`, { force: true });
    try {
      await downloadZip(url, dest, { fetch: fetchImpl, log, maxBytes: MAX_DOWNLOAD, ...downloadOptions });
      ok = true;
      break;
    } catch (err) {
      log(`  这个地址没下载成功：${err?.message ?? err}`);
    }
  }
  if (!ok) {
    fs.rmSync(`${dest}.part`, { force: true });
    const message = '下载没有完成：请检查网络后再试';
    log(message);
    return { code: EXIT.DOWNLOAD, message };
  }
  if (fs.statSync(dest).size > MAX_DOWNLOAD) {
    fs.rmSync(dest, { force: true });
    const message = '下载的包不完整或被改过';
    log(`${message}（超过 ${MAX_DOWNLOAD / 1e6} MB）`);
    return { code: EXIT.BAD_PACKAGE, message };
  }
  beforeApply();
  return applyUpdate({ root, zipFile: dest, version, log, now, io, afterWrite });
}
