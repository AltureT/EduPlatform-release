// 备份 / 恢复 / 重置（管理台规格 §4.5；语义沿用原 manage.sh）
//   backup({ dbPath, backupDir, prefix = 'classroom', now?, statfs? }) → { file, size }
//     better-sqlite3 在线备份到临时文件 → integrity_check 为 ok 且含 students 表 → 改名；权限 600（win32 忽略）
//     备份文件改为单文件格式（journal_mode=DELETE），不留 -wal / -shm，可直接下载
//   snapshot({ ..., prefix: 'pre_restore' | 'pre_reset' })：同 backup，供恢复 / 重置前自动快照
//   listBackups(backupDir) → [{ file, size, mtime }]，按时间倒序，只列白名单文件
//   restore({ dbPath, backupDir, file }) → { file, snapshot }：调用方须保证平台已停止
//   resetOffline({ dbPath, backupDir }) → { snapshot, deleted }：快照后删除库与 -wal / -shm（名单一起清除）
//   resetOnline({ port, dbPath, backupDir }) → { snapshot }：快照后 POST /api/admin/reset（名单保留）
// 拒绝：库文件或备份文件为符号链接、磁盘剩余 < 源文件 × 2（statfs 可注入替身）、快照失败
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const BACKUP_RE = /^(classroom|pre_restore|pre_reset)_[^/\\]*\.db$/;

const userError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

export function isBackupName(name) {
  return typeof name === 'string' && BACKUP_RE.test(name) && !name.includes('..');
}

const pad = (n) => String(n).padStart(2, '0');
export function backupName(prefix, now = new Date()) {
  const d = now;
  return `${prefix}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function uniqueFile(dir, base) {
  let name = `${base}.db`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}_${i}.db`;
  return name;
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function rejectSymlink(p, what) {
  const st = lstatOrNull(p);
  if (st?.isSymbolicLink()) throw userError(`${what}是符号链接，为保护数据已拒绝操作`);
  return st;
}

function requireSpace(dir, need, statfs) {
  let info;
  try {
    info = statfs(dir);
  } catch {
    return; // 平台不支持时跳过
  }
  const free = Number(info.bavail) * Number(info.bsize);
  if (free < need * 2) {
    throw userError(`磁盘空间不足：需要约 ${Math.ceil((need * 2) / 1e6)} MB，剩余 ${Math.floor(free / 1e6)} MB`);
  }
}

function removeQuiet(...files) {
  for (const f of files) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      // ignore
    }
  }
}
const sidecars = (f) => [`${f}-wal`, `${f}-shm`, `${f}-journal`];

function chmod600(f) {
  try {
    fs.chmodSync(f, 0o600);
  } catch {
    // win32 忽略
  }
}

// 校验并整理一个副本：integrity_check 为 ok、含 students 表（空库也会 ok，见原 manage.sh 注释）
function verifyCopy(file, { clearEpoch = false } = {}) {
  let db;
  try {
    db = new Database(file, { fileMustExist: true });
    const check = db.pragma('integrity_check', { simple: true });
    if (check !== 'ok') throw new Error(`integrity_check: ${check}`);
    const has = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'students'").get().n;
    if (has !== 1) throw new Error('缺少 students 表');
    if (clearEpoch) {
      // 强制学生重新登录：删掉 class_epoch，平台下次启动生成新值
      db.prepare("DELETE FROM sessions WHERE key = 'class_epoch'").run();
    }
    db.pragma('journal_mode = DELETE');
  } finally {
    db?.close();
  }
}

const tmpName = (dir, tag) => path.join(dir, `.tmp.${tag}.${crypto.randomBytes(4).toString('hex')}`);

export async function backup({ dbPath, backupDir, prefix = 'classroom', now = new Date(), statfs = fs.statfsSync }) {
  const st = rejectSymlink(dbPath, '数据库文件');
  if (!st) throw userError('还没有课堂数据，无需备份', 404);
  fs.mkdirSync(backupDir, { recursive: true });
  requireSpace(backupDir, st.size, statfs);
  const file = uniqueFile(backupDir, backupName(prefix, now));
  const tmp = tmpName(backupDir, file);
  let src;
  try {
    src = new Database(dbPath, { fileMustExist: true });
    await src.backup(tmp);
    src.close();
    src = null;
    verifyCopy(tmp);
  } catch (err) {
    src?.close();
    removeQuiet(tmp, ...sidecars(tmp));
    throw userError(`备份失败：${err?.message ?? err}`, 500);
  }
  chmod600(tmp);
  fs.renameSync(tmp, path.join(backupDir, file));
  return { file, size: fs.statSync(path.join(backupDir, file)).size };
}

export function snapshot({ prefix, ...opts }) {
  return backup({ ...opts, prefix });
}

// 恢复 / 重置前的快照：库不存在则无需快照（返回 null）；失败则中止
async function safetySnapshot(prefix, { dbPath, backupDir, statfs, now }) {
  if (!lstatOrNull(dbPath)) return null;
  try {
    return (await snapshot({ dbPath, backupDir, prefix, statfs, now })).file;
  } catch (err) {
    throw userError(`操作前自动备份失败，已中止以保护现有数据：${err.message}`, err.status ?? 500);
  }
}

export function listBackups(backupDir) {
  let names;
  try {
    names = fs.readdirSync(backupDir);
  } catch {
    return [];
  }
  const out = [];
  for (const file of names) {
    if (!isBackupName(file)) continue;
    const st = lstatOrNull(path.join(backupDir, file));
    if (!st || !st.isFile()) continue;
    out.push({ file, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime || (a.file < b.file ? 1 : -1));
}

export async function restore({ dbPath, backupDir, file, statfs = fs.statfsSync, now }) {
  if (!isBackupName(file)) throw userError('备份文件名不对');
  const src = path.join(backupDir, file);
  const srcSt = rejectSymlink(src, '备份文件');
  if (!srcSt || !srcSt.isFile()) throw userError('找不到这个备份', 404);
  rejectSymlink(dbPath, '数据库文件');
  const dir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(dir, { recursive: true });
  requireSpace(dir, srcSt.size, statfs);

  // 在库目录里做副本并校验，原备份文件不动
  const tmp = tmpName(dir, 'restore');
  try {
    fs.copyFileSync(src, tmp);
    verifyCopy(tmp, { clearEpoch: true });
  } catch (err) {
    removeQuiet(tmp, ...sidecars(tmp));
    throw userError(`备份文件已损坏，不能恢复（${err?.message ?? err}）`);
  }
  let snap;
  try {
    snap = await safetySnapshot('pre_restore', { dbPath, backupDir, statfs, now });
  } catch (err) {
    removeQuiet(tmp, ...sidecars(tmp));
    throw err;
  }
  // 旧 -wal / -shm 针对旧库的页编号，不清会被回放到新库上
  removeQuiet(`${dbPath}-wal`, `${dbPath}-shm`);
  chmod600(tmp);
  fs.renameSync(tmp, dbPath);
  return { file, snapshot: snap };
}

export async function resetOffline({ dbPath, backupDir, statfs = fs.statfsSync, now }) {
  rejectSymlink(dbPath, '数据库文件');
  const snap = await safetySnapshot('pre_reset', { dbPath, backupDir, statfs, now });
  const targets = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  const deleted = targets.some((f) => lstatOrNull(f));
  for (const f of targets) fs.rmSync(f, { force: true });
  return { snapshot: snap, deleted };
}

export async function resetOnline({ port, dbPath, backupDir, statfs = fs.statfsSync, now }) {
  rejectSymlink(dbPath, '数据库文件');
  const snap = await safetySnapshot('pre_reset', { dbPath, backupDir, statfs, now });
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/admin/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw userError(`平台没有响应重置请求：${err?.message ?? err}`, 502);
  }
  if (!res.ok) throw userError(`平台拒绝了重置请求（${res.status}）`, 502);
  return { snapshot: snap };
}
