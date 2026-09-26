// 快照与恢复（规格 §5、§8）
// snapshot(state) → { lessonId, stagesHash, stageIndex, subPhase, savedAt }，存 sessions KV classroom_snapshot
// hydrate(state, db) 顺序：class_epoch → classroom_snapshot → students → roster / bindings → stage_student_data → stage_class_data
import { createLog } from './log.js';

export const SNAPSHOT_KEY = 'classroom_snapshot';

export function snapshot(state) {
  return {
    lessonId: state.lessonId,
    stagesHash: state.stagesHash,
    stageIndex: state.currentIndex,
    subPhase: state.subPhase,
    savedAt: Date.now(),
  };
}

export function saveSnapshot(state, db) {
  db.setSession(SNAPSHOT_KEY, snapshot(state));
}

// names 缺省时写全部学生
export function saveStudents(state, db, names) {
  const list = names ?? Array.from(state.studentMap.keys());
  const rows = list.map((n) => state.studentRow(n)).filter(Boolean);
  if (rows.length) db.upsertStudents(rows);
}

export function hydrate(state, db, log = createLog('restore')) {
  // 1. class_epoch
  state.classEpoch = db.getOrCreateClassEpoch();

  // 2. classroom_snapshot
  const snap = db.getSession(SNAPSHOT_KEY);
  let lessonChanged = false;
  state.currentIndex = 0;
  state.subPhase = null;
  if (snap && typeof snap === 'object') {
    if (snap.lessonId !== state.lessonId || snap.stagesHash !== state.stagesHash) {
      lessonChanged = true;
    } else {
      const idx = Number.isInteger(snap.stageIndex) ? snap.stageIndex : 0;
      state.currentIndex = Math.min(Math.max(idx, 0), state.stageIds.length - 1);
      const list = state.stageConfig(state.currentStage)?.subPhases;
      const sp = typeof snap.subPhase === 'string' ? snap.subPhase : null;
      state.subPhase = sp !== null && Array.isArray(list) && !list.includes(sp) ? null : sp;
    }
  }

  // 3. students（含 entered_stage_*），全部离线
  state.studentMap.clear();
  const rows = db.loadStudents();

  // 4. roster / bindings（绑定先于学生写入内存，以便回填 deviceId）
  state.rehydrateRoster(db.loadRoster());
  state.rehydrateDeviceBindings(db.loadDeviceBindings());
  for (const row of rows) {
    state.rehydrateStudent(lessonChanged ? { ...row, enteredStageAt: null, enteredStageIndex: null } : row);
  }

  // 5. stage_student_data  6. stage_class_data（课程变更时也保留）
  state.data.clear();
  for (const r of db.loadStageStudentData()) state.data.set(r.stageId, r.name, r.data);
  for (const r of db.loadStageClassData()) state.data.setClass(r.stageId, r.data);

  if (lessonChanged) {
    log.warn('lesson changed, stage reset');
    db.transaction(() => {
      saveStudents(state, db);
      saveSnapshot(state, db);
    });
  }
  return { lessonChanged };
}
