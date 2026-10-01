// 备份 / 恢复 / 重置（管理台规格 §4.5；语义沿用原 manage.sh）
//   backup({ dbPath, backupDir, prefix = 'classroom', now?, statfs? }) → { file, size }
//     better-sqlite3 在线备份到临时文件 → integrity_check 为 ok 且含 students 表 → 改名；权限 600（win32 忽略）
//     备份文件改为单文件格式（journal_mode=DELETE），不留 -wal / -shm，可直接下载
//   snapshot({ ..., prefix: 'pre_restore' | 'pre_reset' })：同 backup，供恢复 / 重置前自动快照
//   listBackups(backupDir) → [{ file, size, mtime }]，按时间倒序，只列白名单文件
//   restore({ dbPath, backupDir, file, snapshotDir? }) → { file, snapshot }：调用方须保证这个库没有在用；pre_restore 快照放 snapshotDir（缺省 backupDir；M6 从未归类备份恢复到某门课时放那门课的目录）
//   resetOffline({ dbPath, backupDir }) → { snapshot, cleared }：快照后清课堂数据、保留名单（与在线一致：resetClassroom + VACUUM）；库不存在 cleared: false
//   resetOnline({ port, dbPath, backupDir }) → { snapshot }：快照后 POST /api/admin/reset（名单保留）
// 拒绝：库文件或备份文件为符号链接、磁盘剩余 < 源文件 × 2（statfs 可注入替身）、快照失败
// M6（名单与数据以课程为主体规格 §2.3）：
//   lessonPaths(root, id, { customDb }) → { dbPath, backupDir }：课程 → data/lessons/<id>.sqlite 与 backups/lessons/<id>/；
//     id = '_unsorted'（迁移时读不出课程的旧库）→ data/lessons/_unsorted.sqlite 与 backups/（旧备份所在，"未归类备份"）；
//     customDb（.env 显式 DB_PATH）→ 那个库与 backups/（全平台一个库，照旧）
//   listBackups(backupDir, { withLesson }) 的每项可带 lessonId（备份里 classroom_snapshot.lessonId，恢复到指定课程时核对来源）
//   backupLessonId(backupDir, file) → 同上，单个文件
//   dataSummary({ dbPath, backupDir }) → { roster, dbBytes, lastBackup } | null（库不存在）：课程列表（第 1 步）卡片"名单 N 人 · 数据 M KB · 最近备份"
//   moveLessonData(root, id, destDir) → { moved: [...] }：删课连带——data/lessons/<id>.sqlite* 与 backups/lessons/<id>/ 移到 destDir/data/
//   removeUnsorted(root, { now }) → { movedTo }：未归类的旧数据"删除"——移到 backups/deleted-lessons/_unsorted-<ts>/data/（不直接删）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../kernel/server/db.js';
import { lessonDbPath, UNSORTED_ID } from '../../kernel/server/lesson-db-path.js';
import { snapshotLessonId } from './migrate-db.js';

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

export const LESSON_BACKUPS_DIR = 'backups/lessons';
export const DELETED_DIR = 'backups/deleted-lessons';

export function lessonPaths(root, id, { customDb = null } = {}) {
  const flat = path.join(root, 'backups');
  if (customDb) return { dbPath: path.resolve(root, customDb), backupDir: flat };
  if (id === UNSORTED_ID) return { dbPath: lessonDbPath(root, UNSORTED_ID), backupDir: flat };
  return { dbPath: lessonDbPath(root, id), backupDir: path.join(root, ...LESSON_BACKUPS_DIR.split('/'), id) };
}

export function backupLessonId(backupDir, file) {
  if (!isBackupName(file)) return null;
  const f = path.join(backupDir, file);
  const st = lstatOrNull(f);
  if (!st || !st.isFile()) return null;
  return snapshotLessonId(f);
}

export function listBackups(backupDir, { withLesson = false } = {}) {
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
    const item = { file, size: st.size, mtime: st.mtimeMs };
    if (withLesson) item.lessonId = snapshotLessonId(path.join(backupDir, file));
    out.push(item);
  }
  return out.sort((a, b) => b.mtime - a.mtime || (a.file < b.file ? 1 : -1));
}

export async function restore({ dbPath, backupDir, file, snapshotDir = backupDir, statfs = fs.statfsSync, now }) {
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
    snap = await safetySnapshot('pre_restore', { dbPath, backupDir: snapshotDir, statfs, now });
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
  if (!lstatOrNull(dbPath)) return { snapshot: null, cleared: false };
  const snap = await safetySnapshot('pre_reset', { dbPath, backupDir, statfs, now });
  // 与在线重置同一口径：清学生、设备绑定、阶段数据，换新 class_epoch；名单保留
  const db = openDb(dbPath);
  try {
    db.resetClassroom();
    db.raw.exec('VACUUM');
  } finally {
    db.close();
  }
  return { snapshot: snap, cleared: true };
}

function fileSize(f) {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
}

// 只读数名单人数（平台运行中也能读：WAL 允许并发读）；读不出按 0
function rosterCount(dbPath) {
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return db.prepare('SELECT COUNT(*) AS n FROM roster').get().n;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

export function dataSummary({ dbPath, backupDir }) {
  const st = lstatOrNull(dbPath);
  if (!st || !st.isFile()) return null;
  const list = listBackups(backupDir);
  return {
    roster: rosterCount(dbPath),
    dbBytes: st.size + fileSize(`${dbPath}-wal`),
    lastBackup: list.length ? { file: list[0].file, mtime: list[0].mtime } : null,
  };
}

// 删课连带：这门课的库（连 -wal / -shm）与备份目录移到 destDir/data/（库文件名不变，备份放 destDir/data/backups/）
export function moveLessonData(root, id, destDir) {
  const { dbPath, backupDir } = lessonPaths(root, id);
  const dataDir = path.join(destDir, 'data');
  const moved = [];
  const move = (from, to) => {
    if (!lstatOrNull(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    moved.push(path.relative(root, from).split(path.sep).join('/'));
  };
  for (const sfx of ['', '-wal', '-shm']) move(dbPath + sfx, path.join(dataDir, path.basename(dbPath) + sfx));
  move(backupDir, path.join(dataDir, 'backups'));
  return { moved };
}

const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

// 未归类的旧数据"删除"：整份移到 backups/deleted-lessons/_unsorted-<ts>/data/，不直接删
export function removeUnsorted(root, { now = new Date() } = {}) {
  const { dbPath } = lessonPaths(root, UNSORTED_ID);
  rejectSymlink(dbPath, '数据库文件');
  if (!lstatOrNull(dbPath)) throw userError('没有未归类的旧数据', 404);
  const parent = path.join(root, ...DELETED_DIR.split('/'));
  const baseName = `${UNSORTED_ID}-${stamp(now)}`;
  let name = baseName;
  for (let i = 2; fs.existsSync(path.join(parent, name)); i += 1) name = `${baseName}_${i}`;
  const dataDir = path.join(parent, name, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  for (const sfx of ['', '-wal', '-shm']) {
    if (lstatOrNull(dbPath + sfx)) fs.renameSync(dbPath + sfx, path.join(dataDir, path.basename(dbPath) + sfx));
  }
  return { movedTo: `${DELETED_DIR}/${name}` };
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
