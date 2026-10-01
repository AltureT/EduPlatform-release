// 一次性迁移（名单与数据以课程为主体规格 §2.2）：工作台启动时调用
//   migrateDb(root, { now?, customDb?, log? }) → null（无需迁移）| 记录 { at, from, to, lessonId, unsorted, shown: false }
//     data/classroom.sqlite（旧的全平台一个库）存在、是普通文件、.env 没有自定义 DB_PATH 时：
//     先 checkpoint（-wal 并进主文件），读 sessions.classroom_snapshot.lessonId；
//     合法且 data/lessons/ 下还没有这门课的库 → 改名为 data/lessons/<lessonId>.sqlite；
//     没有 / 不合法 / 那门课已有库 → data/lessons/_unsorted.sqlite（数据页"未归类的旧数据"）；_unsorted 也已有 → 不动，记日志
//     残留的 -wal / -shm 跟着改名；结果写 data/lessons/.migrated.json
//   takeMigratedNotice(root) → 还没提示过的迁移记录（取出后标 shown，首页只提示一次）| null
//   snapshotLessonId(file) → 库或备份里 classroom_snapshot.lessonId（读不出 null）；恢复备份时核对来源也用它
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { lessonDbPath, lessonIdError, LESSONS_DATA_DIR, UNSORTED_ID } from '../../kernel/server/lesson-db-path.js';

export const OLD_DB = 'data/classroom.sqlite';
export const MIGRATED_FILE = `${LESSONS_DATA_DIR}/.migrated.json`;

const abs = (root, rel) => path.join(root, ...rel.split('/'));
const lstatOrNull = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

export function snapshotLessonId(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT value FROM sessions WHERE key = 'classroom_snapshot'").get();
    const v = row ? JSON.parse(row.value) : null;
    return typeof v?.lessonId === 'string' ? v.lessonId : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

// 读写打开：先把 -wal 并进主文件（TRUNCATE），再读快照里的课程 id；关库时 SQLite 会删掉空的 -wal / -shm
function checkpointAndReadId(file, log) {
  let db;
  try {
    db = new Database(file, { fileMustExist: true });
    db.pragma('wal_checkpoint(TRUNCATE)');
    const row = db.prepare("SELECT value FROM sessions WHERE key = 'classroom_snapshot'").get();
    const v = row ? JSON.parse(row.value) : null;
    return typeof v?.lessonId === 'string' ? v.lessonId : null;
  } catch (err) {
    log(`[manage] 读旧课堂数据的课程时出错（按未归类处理）：${err?.message ?? err}`);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export function migrateDb(root, { now = new Date(), customDb = null, log = () => {} } = {}) {
  if (customDb) return null;
  const from = abs(root, OLD_DB);
  const st = lstatOrNull(from);
  if (!st || !st.isFile()) return null;
  fs.mkdirSync(abs(root, LESSONS_DATA_DIR), { recursive: true });
  const lessonId = checkpointAndReadId(from, log);
  // M6 审查：目标库或它的 -wal / -shm 任一存在都算"已有库"（不覆盖、不让旧的 -wal 回放到别的库上）
  const taken = (f) => ['', '-wal', '-shm'].some((sfx) => lstatOrNull(f + sfx));
  let id = lessonId && !lessonIdError(lessonId) ? lessonId : UNSORTED_ID;
  if (id !== UNSORTED_ID && taken(lessonDbPath(root, id))) id = UNSORTED_ID;
  const to = lessonDbPath(root, id);
  if (taken(to)) {
    log(`[manage] ${OLD_DB} 没有整理：${LESSONS_DATA_DIR}/ 里已有同名的库`);
    return null;
  }
  fs.renameSync(from, to);
  for (const sfx of ['-wal', '-shm']) {
    if (lstatOrNull(from + sfx)) fs.renameSync(from + sfx, to + sfx);
  }
  const record = {
    at: now.getTime(),
    from: OLD_DB,
    to: `${LESSONS_DATA_DIR}/${id}.sqlite`,
    lessonId: id === UNSORTED_ID ? null : id,
    unsorted: id === UNSORTED_ID,
    shown: false,
  };
  fs.writeFileSync(abs(root, MIGRATED_FILE), `${JSON.stringify(record, null, 2)}\n`);
  log(`[manage] 课堂数据已按课程整理：${OLD_DB} → ${record.to}`);
  return record;
}

export function takeMigratedNotice(root) {
  const file = abs(root, MIGRATED_FILE);
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!rec || typeof rec !== 'object' || rec.shown) return null;
  try {
    fs.writeFileSync(file, `${JSON.stringify({ ...rec, shown: true }, null, 2)}\n`);
  } catch {
    // 写不回也只是下次再提示一次
  }
  return { at: rec.at ?? null, lessonId: rec.lessonId ?? null, unsorted: Boolean(rec.unsorted) };
}
