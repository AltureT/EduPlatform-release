// useComponent(id)（规格 v0.5 §2.3，公开导出）
// 返回 { options, role, me, lesson, isEnabledFor, slice, setLocal, send, data, stageData, authFetch, currentStage, classEpoch }：
// - role 由外壳的 KernelRoleContext 决定；me 形状同契约 §四（教师端 null）；lesson = { id, title, glyph }
// - isEnabledFor(stageId)：prelogin / curtain 恒为 true；否则组件已打开且（stages 为 null 或包含该阶段）
// - send：教师端只放行 `<id>:t-`，学生端只放行 `<id>:s-`，否则抛错
// - data 来自 stageId `component:<id>`：学生端 perStudent 恒为 {}、my 无记录为 undefined；perClass 默认 {}
// - stageData(stageId)：教师端始终读 liveStageData（不受统计暂停影响）；学生端 { perStudent: {}, perClass: classData[stageId] ?? {} }
// - authFetch：教师端带 Authorization: Bearer <token> 的 fetch；学生端调用即抛错
// - K2（v0.6）currentStage = { id, index }：本端 core store 的 stage / stageIndex（教师端是当前阶段，不是查看的阶段）；
//   classEpoch：学生端来自 coreStudentStore；教师 store 有意不保存它，教师端恒为 null
import { useCallback, useMemo } from 'react';
import { socket } from '../socket.js';
import { coreStudentStore } from '../stores/coreStudentStore.js';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import { setComponentLocal, useComponentSlices, getComponentRegistry } from '../stores/componentRegistry.js';
import { useKernelRole } from './roleContext.js';

const EMPTY = Object.freeze({});
const ALWAYS_ENABLED = ['prelogin', 'curtain'];

function useComponentEntry(role, id) {
  const studentList = coreStudentStore((s) => s.components);
  const teacherList = coreTeacherStore((s) => s.components);
  const list = role === 'teacher' ? teacherList : studentList;
  return Array.isArray(list) ? list.find((c) => c && c.id === id) ?? null : null;
}

export function useComponent(id) {
  getComponentRegistry();
  const role = useKernelRole();
  const entry = useComponentEntry(role, id);
  const sid = `component:${id}`;

  const studentMe = coreStudentStore((s) => s.me);
  const studentLesson = coreStudentStore((s) => s.lesson);
  const teacherLesson = coreTeacherStore((s) => s.lesson);
  const myStageData = coreStudentStore((s) => s.myStageData);
  const classData = coreStudentStore((s) => s.classData);
  const live = coreTeacherStore((s) => s.liveStageData);
  const slice = useComponentSlices((s) => s[role][id]);
  const studentStage = coreStudentStore((s) => s.stage);
  const studentStageIndex = coreStudentStore((s) => s.stageIndex);
  const teacherStage = coreTeacherStore((s) => s.stage);
  const teacherStageIndex = coreTeacherStore((s) => s.stageIndex);
  const studentEpoch = coreStudentStore((s) => s.classEpoch);

  const stageIdNow = (role === 'teacher' ? teacherStage : studentStage) ?? 'prelogin';
  const stageIndexNow = (role === 'teacher' ? teacherStageIndex : studentStageIndex) ?? 0;
  const currentStage = useMemo(() => ({ id: stageIdNow, index: stageIndexNow }), [stageIdNow, stageIndexNow]);

  const lessonSrc = role === 'teacher' ? teacherLesson : studentLesson;
  const lesson = useMemo(
    () => ({ id: lessonSrc.id ?? null, title: lessonSrc.title ?? '', glyph: lessonSrc.glyph ?? '' }),
    [lessonSrc],
  );

  const isEnabledFor = useCallback((stageId) => {
    if (ALWAYS_ENABLED.includes(stageId)) return true;
    if (!entry) return false;
    return !Array.isArray(entry.stages) || entry.stages.includes(stageId);
  }, [entry]);

  const setLocal = useCallback((patch) => setComponentLocal(role, id, patch), [role, id]);

  const send = useCallback((event, payload) => {
    const prefix = `${id}:${role === 'teacher' ? 't' : 's'}-`;
    if (typeof event !== 'string' || !event.startsWith(prefix) || event.length === prefix.length) {
      throw new Error(`[useComponent:${id}] 只允许 ${prefix}* 事件：${event}`);
    }
    socket.emit(event, payload);
  }, [id, role]);

  const data = useMemo(() => {
    if (role === 'teacher') {
      const d = live[sid];
      return { my: undefined, perStudent: (d && d.perStudent) || EMPTY, perClass: (d && d.perClass) || EMPTY };
    }
    return { my: myStageData[sid], perStudent: EMPTY, perClass: classData[sid] ?? EMPTY };
  }, [role, live, myStageData, classData, sid]);

  const stageData = useCallback((stageId) => {
    if (role === 'teacher') {
      const d = live[stageId];
      return { perStudent: (d && d.perStudent) || EMPTY, perClass: (d && d.perClass) || EMPTY };
    }
    return { perStudent: EMPTY, perClass: classData[stageId] ?? EMPTY };
  }, [role, live, classData]);

  const authFetch = useCallback((path, init = {}) => {
    if (role !== 'teacher') throw new Error(`[useComponent:${id}] authFetch 仅教师端可用`);
    const token = coreTeacherStore.getState().token;
    const headers = new Headers(init && init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(path, { ...init, headers });
  }, [role, id]);

  return {
    options: (entry && entry.options) || EMPTY,
    role,
    me: role === 'teacher' ? null : studentMe,
    lesson,
    isEnabledFor,
    slice,
    setLocal,
    send,
    data,
    stageData,
    authFetch,
    currentStage,
    classEpoch: role === 'teacher' ? null : studentEpoch ?? null,
  };
}

export default useComponent;
