// 每门课一个库（名单与数据以课程为主体规格 §2.1）：工作台与平台共用
//   LESSON_ID_RE：课程 id 规则（小写字母开头，只含小写字母、数字、连字符，2–40 个字符）
//   WINDOWS_RESERVED_RE / isWindowsReservedName(id)：con、prn、aux、nul、com1–9、lpt1–9（S19，不分大小写）
//   lessonIdError(id) → null | 中文报错（缺少 / 不合法 / Windows 保留名）；loadLesson 与 check:lesson 用同一句
//   lessonDbPath(root, id) → <root>/data/lessons/<id>.sqlite（id 不合法抛错；UNSORTED_ID 例外）
//   LESSONS_DATA_DIR = 'data/lessons'；UNSORTED_ID = '_unsorted'（旧库迁移时读不出课程的去处，不是合法课程 id）
//   isOldDefaultDbPath(v)：DB_PATH 等于旧缺省 data/classroom.sqlite（视为没设置）
import path from 'node:path';

export const LESSON_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const LESSONS_DATA_DIR = 'data/lessons';
export const UNSORTED_ID = '_unsorted';

// S19：Windows 不允许的文件夹名（不分大小写）；课程 id 与阶段 id 都挡掉
export const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export function isWindowsReservedName(id) {
  return typeof id === 'string' && WINDOWS_RESERVED_RE.test(id);
}
export const windowsReservedMessage = (id) => `id "${id}" 是 Windows 不允许的文件夹名，换一个`;

export function lessonIdError(id) {
  if (id === undefined || id === null || id === '') return 'lesson.config.js 缺少 id';
  if (typeof id !== 'string' || !LESSON_ID_RE.test(id)) {
    return `lesson.config.js 的 id ${JSON.stringify(id)} 不对：id 只能是小写字母、数字、连字符（小写字母开头，2–40 个字符）`;
  }
  if (isWindowsReservedName(id)) return windowsReservedMessage(id);
  return null;
}

// 旧缺省 DB_PATH（全平台一个库时的位置）：.env 里写的是它，视为"没设置"（按课程分库）；平台与工作台同一口径
export const OLD_DEFAULT_DB_PATH = 'data/classroom.sqlite';
export function isOldDefaultDbPath(v) {
  const s = String(v ?? '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  return s === OLD_DEFAULT_DB_PATH;
}

export function lessonDbPath(root, id) {
  const err = id === UNSORTED_ID ? null : lessonIdError(id);
  if (err) throw new Error(err);
  return path.join(path.resolve(root), ...LESSONS_DATA_DIR.split('/'), `${id}.sqlite`);
}
