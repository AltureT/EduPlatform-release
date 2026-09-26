// 持久化（规格 §8）：better-sqlite3；WAL、foreign_keys=ON；PRAGMA user_version 递增迁移
// openDb(path) → 实例 API；scripts/admin-roster.js 与 test-utils/memDb.js 也用它
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const MIGRATIONS = [
  // v1：八张表
  `
  CREATE TABLE IF NOT EXISTS students (
    name TEXT PRIMARY KEY,
    joined_at INTEGER,
    last_seen INTEGER,
    entered_stage_at INTEGER,
    entered_stage_index INTEGER
  );
  CREATE TABLE IF NOT EXISTS roster (
    name TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL,
    added_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS device_bindings (
    device_id TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    bound_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_device_bindings_name ON device_bindings(student_name);
  CREATE TABLE IF NOT EXISTS sessions (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS stage_student_data (
    stage_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (stage_id, student_name)
  );
  CREATE TABLE IF NOT EXISTS stage_class_data (
    stage_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id TEXT,
    student_name TEXT,
    type TEXT NOT NULL,
    payload TEXT,
    ts INTEGER NOT NULL,
    class_epoch TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_stage_events_student ON stage_events(student_name);
  CREATE TABLE IF NOT EXISTS teacher_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    stage_id TEXT,
    payload TEXT,
    ts INTEGER NOT NULL,
    class_epoch TEXT
  );
  `,
];

const toJson = (v) => (v === undefined ? null : JSON.stringify(v));
const fromJson = (s) => (s == null ? null : JSON.parse(s));

// AF 生成规则：epoch-<ts>-<rand>
export function newEpoch() {
  return `epoch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function migrate(raw) {
  const current = raw.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    raw.transaction(() => {
      raw.exec(MIGRATIONS[v]);
      raw.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  migrate(raw);

  const st = {
    getSession: raw.prepare('SELECT value FROM sessions WHERE key = ?'),
    setSession: raw.prepare(
      'INSERT INTO sessions (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ),
    upsertStudent: raw.prepare(`
      INSERT INTO students (name, joined_at, last_seen, entered_stage_at, entered_stage_index)
      VALUES (@name, @joinedAt, @lastSeen, @enteredStageAt, @enteredStageIndex)
      ON CONFLICT(name) DO UPDATE SET
        joined_at = excluded.joined_at,
        last_seen = excluded.last_seen,
        entered_stage_at = excluded.entered_stage_at,
        entered_stage_index = excluded.entered_stage_index`),
    loadStudents: raw.prepare(
      'SELECT name, joined_at, last_seen, entered_stage_at, entered_stage_index FROM students ORDER BY joined_at, rowid',
    ),
    clearRoster: raw.prepare('DELETE FROM roster'),
    insertRoster: raw.prepare('INSERT OR IGNORE INTO roster (name, ordinal, added_at) VALUES (?, ?, ?)'),
    loadRoster: raw.prepare('SELECT name, ordinal, added_at FROM roster ORDER BY ordinal'),
    deleteBindingByName: raw.prepare('DELETE FROM device_bindings WHERE student_name = ?'),
    deleteBindingByNameExcept: raw.prepare('DELETE FROM device_bindings WHERE student_name = ? AND device_id <> ?'),
    upsertBinding: raw.prepare(`
      INSERT INTO device_bindings (device_id, student_name, bound_at) VALUES (?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET student_name = excluded.student_name, bound_at = excluded.bound_at`),
    loadBindings: raw.prepare('SELECT device_id, student_name, bound_at FROM device_bindings ORDER BY bound_at, rowid'),
    clearBindings: raw.prepare('DELETE FROM device_bindings'),
    setStudentData: raw.prepare(`
      INSERT INTO stage_student_data (stage_id, student_name, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(stage_id, student_name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
    loadStudentData: raw.prepare(
      'SELECT stage_id, student_name, data, updated_at FROM stage_student_data ORDER BY stage_id, student_name',
    ),
    setClassData: raw.prepare(`
      INSERT INTO stage_class_data (stage_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(stage_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
    loadClassData: raw.prepare('SELECT stage_id, data, updated_at FROM stage_class_data ORDER BY stage_id'),
    appendEvent: raw.prepare(
      'INSERT INTO stage_events (stage_id, student_name, type, payload, ts, class_epoch) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    loadEvents: raw.prepare(
      'SELECT stage_id, type, payload, ts FROM stage_events WHERE student_name = ? ORDER BY id',
    ),
    loadEventsByEpoch: raw.prepare(
      'SELECT stage_id, type, payload, ts FROM stage_events WHERE student_name = ? AND class_epoch = ? ORDER BY id',
    ),
    deleteStudent: raw.prepare('DELETE FROM students WHERE name = ?'),
    appendAction: raw.prepare(
      'INSERT INTO teacher_actions (type, stage_id, payload, ts, class_epoch) VALUES (?, ?, ?, ?, ?)',
    ),
  };

  const getSession = (key) => {
    const row = st.getSession.get(key);
    return row ? fromJson(row.value) : null;
  };
  const setSession = (key, value) => {
    st.setSession.run(key, toJson(value));
  };

  const studentRow = (row) => ({
    name: row.name,
    joinedAt: row.joinedAt ?? null,
    lastSeen: row.lastSeen ?? null,
    enteredStageAt: row.enteredStageAt ?? null,
    enteredStageIndex: row.enteredStageIndex ?? null,
  });

  const upsertStudents = raw.transaction((rows) => {
    for (const r of rows) st.upsertStudent.run(studentRow(r));
  });

  const replaceRoster = raw.transaction((names) => {
    st.clearRoster.run();
    const now = Date.now();
    let ordinal = 0;
    for (const n of names || []) {
      if (typeof n !== 'string' || !n) continue;
      if (st.insertRoster.run(n, ordinal, now).changes > 0) ordinal++;
    }
    return ordinal;
  });

  const upsertDeviceBinding = raw.transaction((deviceId, name) => {
    st.deleteBindingByNameExcept.run(name, deviceId);
    st.upsertBinding.run(deviceId, name, Date.now());
  });

  let closed = false;

  const resetClassroom = raw.transaction(() => {
    raw.exec(`
      DELETE FROM students;
      DELETE FROM device_bindings;
      DELETE FROM stage_student_data;
      DELETE FROM stage_class_data;
    `);
    const epoch = newEpoch();
    setSession('class_epoch', epoch);
    return epoch;
  });

  return {
    raw,
    transaction: (fn) => raw.transaction(fn)(),

    getSession,
    setSession,

    upsertStudent: (row) => st.upsertStudent.run(studentRow(row)),
    upsertStudents: (rows) => upsertStudents(rows),
    deleteStudent: (name) => {
      st.deleteStudent.run(name);
    },
    loadStudents: () =>
      st.loadStudents.all().map((r) => ({
        name: r.name,
        joinedAt: r.joined_at,
        lastSeen: r.last_seen,
        enteredStageAt: r.entered_stage_at,
        enteredStageIndex: r.entered_stage_index,
      })),

    replaceRoster: (names) => replaceRoster(names),
    loadRoster: () => st.loadRoster.all().map((r) => ({ name: r.name, ordinal: r.ordinal, addedAt: r.added_at })),
    clearRoster: () => {
      st.clearRoster.run();
    },

    upsertDeviceBinding: (deviceId, name) => upsertDeviceBinding(deviceId, name),
    loadDeviceBindings: () =>
      st.loadBindings.all().map((r) => ({ deviceId: r.device_id, studentName: r.student_name, boundAt: r.bound_at })),
    clearDeviceBindings: () => {
      st.clearBindings.run();
    },
    deleteDeviceBindingByName: (name) => {
      st.deleteBindingByName.run(name);
    },

    setStageStudentData: (stageId, name, data) => {
      st.setStudentData.run(stageId, name, toJson(data), Date.now());
    },
    loadStageStudentData: () =>
      st.loadStudentData.all().map((r) => ({
        stageId: r.stage_id,
        name: r.student_name,
        data: fromJson(r.data),
        updatedAt: r.updated_at,
      })),
    setStageClassData: (stageId, data) => {
      st.setClassData.run(stageId, toJson(data), Date.now());
    },
    loadStageClassData: () =>
      st.loadClassData.all().map((r) => ({ stageId: r.stage_id, data: fromJson(r.data), updatedAt: r.updated_at })),

    appendStageEvent: (stageId, name, type, payload, epoch) => {
      st.appendEvent.run(stageId ?? null, name ?? null, type, toJson(payload), Date.now(), epoch ?? null);
    },
    // epoch 给出时只取该课堂 epoch 的事件（教师详情按当前 epoch 过滤）
    loadStageEvents: (name, epoch) =>
      (epoch === undefined ? st.loadEvents.all(name) : st.loadEventsByEpoch.all(name, epoch)).map((r) => ({
        stageId: r.stage_id,
        type: r.type,
        payload: fromJson(r.payload),
        ts: r.ts,
      })),
    appendTeacherAction: (type, stageId, payload, epoch) => {
      st.appendAction.run(type, stageId ?? null, toJson(payload), Date.now(), epoch ?? null);
    },

    getOrCreateClassEpoch: () => {
      const existing = getSession('class_epoch');
      if (typeof existing === 'string' && existing) return existing;
      const epoch = newEpoch();
      setSession('class_epoch', epoch);
      return epoch;
    },
    resetClassroom: () => resetClassroom(),

    get open() {
      return !closed;
    },
    close: () => {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}
