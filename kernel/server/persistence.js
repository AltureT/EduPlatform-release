// 快照与恢复（规格 §5、§8）
// snapshot(state) → { lessonId, stagesHash, stageIndex, subPhase, savedAt }，存 sessions KV classroom_snapshot
// hydrate(state, db) 顺序：class_epoch → classroom_snapshot → students → roster / bindings → stage_student_data → stage_class_data
//   → component_teacher_data（C7：载入 state.componentTeacherData = Map<componentId, Map<key, JSON 串>>；换课时不载入并清表）
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

  // 7. component_teacher_data（教师专属组件存储；换课清空）
  const teacherData = new Map();
  if (!lessonChanged) {
    for (const r of db.loadComponentTeacherData?.() ?? []) {
      if (!teacherData.has(r.componentId)) teacherData.set(r.componentId, new Map());
      teacherData.get(r.componentId).set(r.key, r.value);
    }
  }
  state.componentTeacherData = teacherData;

  if (lessonChanged) {
    log.warn('lesson changed, stage reset');
    db.transaction(() => {
      saveStudents(state, db);
      saveSnapshot(state, db);
      db.clearDrafts?.(); // 草稿不跨课（学生输入自动保存规格 §2.3）
      db.clearComponentTeacherData?.(); // 教师专属组件存储不跨课
    });
  }
  return { lessonChanged };
}
