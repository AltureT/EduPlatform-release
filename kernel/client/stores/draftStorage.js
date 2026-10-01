// 学生草稿的本地层（学生输入自动保存规格 §2.2）：localStorage，读写一律 try/catch，失败静默
// 键 draft:<lessonId>:<classEpoch>:<name>:<stageId>:<field>；值为 JSON
// 不依赖 store / socket，coreStudentStore 与 kernel/client/drafts.js 都用它（避免循环依赖）

export const DRAFT_FIELD_RE = /^[a-z][a-z0-9_-]{0,39}$/;

// → 键；lessonId / name / stageId / field 缺一返回 null（不存）
export function draftKey({ lessonId, classEpoch, name, stageId, field } = {}) {
  if (!lessonId || !name || !stageId || !field) return null;
  return `draft:${lessonId}:${classEpoch ?? null}:${name}:${stageId}:${field}`;
}

function ls() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// 没有 / 读不了 / 不是合法 JSON → undefined（与"存的就是 null"区分）
export function readDraft(key) {
  if (!key) return undefined;
  try {
    const raw = ls()?.getItem(key);
    if (raw == null) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// value 为 undefined 时删除
export function writeDraft(key, value) {
  if (!key) return;
  try {
    if (value === undefined) ls()?.removeItem(key);
    else ls()?.setItem(key, JSON.stringify(value));
  } catch {
    // 配额满 / 不可用：忽略
  }
}

export function clearDraft(key) {
  if (!key) return;
  try {
    ls()?.removeItem(key);
  } catch {
    // 忽略
  }
}

export function clearKeysWithPrefix(prefix) {
  if (!prefix) return;
  try {
    const s = ls();
    if (!s) return;
    const keys = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // 忽略
  }
}

// 清本课全部草稿（前缀 draft:<lessonId>:）
export function clearLessonDrafts(lessonId) {
  if (!lessonId) return;
  clearKeysWithPrefix(`draft:${lessonId}:`);
}

// 课堂重置代数：重置时 +1；useDraft 挂载时记下，代数变了就不再写（防止重置后卸载时把旧草稿写回）
let generation = 0;
export function draftGeneration() {
  return generation;
}
export function bumpDraftGeneration() {
  generation += 1;
  return generation;
}
