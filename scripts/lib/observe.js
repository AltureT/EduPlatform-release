// 观测内核状态（供 e2e-restart）：教师 / 学生 join-ok 载荷（规格 §5.2）与 SQLite 只读快照（规格 §8）
import Database from 'better-sqlite3';
import { io } from 'socket.io-client';

function joinAndRead(base, { emit, payload, ok, error, label }, timeout) {
  const socket = io(base, { autoConnect: false, transports: ['websocket'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(reject, new Error(`${label}：等待 ${ok} 超时（${timeout} ms）`)), timeout);
    function done(fn, value) {
      clearTimeout(timer);
      socket.off(ok);
      socket.off(error);
      socket.disconnect();
      fn(value);
    }
    socket.on('connect', () => socket.emit(emit, payload));
    socket.on(ok, (p) => done(resolve, p));
    socket.on(error, (e) => done(reject, new Error(`${label}：${error}：${e?.message ?? JSON.stringify(e)}`)));
    socket.connect();
  });
}

/** 以一条独立教师连接 join，返回 teacher:join-ok 载荷 { state, stageData }，随即断开 */
export function observeTeacher({ base, token }, timeout = 5000) {
  return joinAndRead(base, {
    emit: 'teacher:join', payload: { token }, ok: 'teacher:join-ok', error: 'teacher:join-error', label: '教师 join',
  }, timeout);
}

/**
 * 学生以 { name, deviceId } 重连，返回完整 student:join-ok 载荷（含 myStageData），随即断开。
 * virtualStudent 只返回句柄、不暴露 join-ok 载荷，故观测重连时直接读事件。
 */
export function observeStudentJoin({ base, name, deviceId }, timeout = 5000) {
  return joinAndRead(base, {
    emit: 'student:join', payload: { name, deviceId }, ok: 'student:join-ok', error: 'student:join-error',
    label: `学生 ${name} 重连`,
  }, timeout);
}

/** 服务停止后只读打开 dbPath：stage_student_data 行数与 students 的 entered_stage_* */
export function readDbSnapshot(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const stageStudentRows = db.prepare('SELECT COUNT(*) AS n FROM stage_student_data').get().n;
    const students = {};
    for (const r of db.prepare('SELECT name, entered_stage_at, entered_stage_index FROM students').all()) {
      students[r.name] = { enteredStageAt: r.entered_stage_at, enteredStageIndex: r.entered_stage_index };
    }
    return { stageStudentRows, students };
  } finally {
    db.close();
  }
}
