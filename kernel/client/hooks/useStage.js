// 阶段视图 hooks（规格 §9.1；契约 §四）
//
// 约定（已获协调方认可）：
// - send 只放行本端前缀（学生 student:*，教师 teacher:*），前缀不符抛错（契约 §四）。
// - 内核保留事件（契约 v0.4.1）经 send 发出时抛错：
//   教师 teacher:advance* / teacher:join* / teacher:admin-* / teacher:import-roster / teacher:clear-roster /
//   teacher:reset-classroom / teacher:release-binding / teacher:get-student-detail；
//   学生 student:join* / student:switch-name / student:request-claim-release*。
// - 教师视图推进用 useTeacherStage 返回的 advance({ force } = {})，转调 coreTeacherStore.advance，
//   沿用"回看时不推进"的守卫；教师外壳不提供通用的"下一阶段"按钮，由阶段视图用公开的 ConfirmAdvanceBtn 放置。
// - 学生端 send 不因回看而拦截（规格未要求）；回看锁由外壳按 reviewInteractive 施加 inert。
// - v0.5 镜像（规格 §2.4）：处于 MirrorProvider 内时 useStudentStage 读 record / classData / me；
//   isLive / subPhase 的"当前阶段"取本端 core store（教师端 coreTeacherStore，学生端 coreStudentStore）；
//   slice = 该阶段 student 切片的 initial；send 为 no-op 并 console.warn；readOnly: true（非镜像 false）。
// - v0.8：两个 hook 都返回 options（classroom:state.stages[i].options，非原语阶段 null）；stage 为有效 config（stage.options 同值）。
//   id 可缺省：取外壳为本视图提供的阶段（PageStageContext.config.id）——原语的默认视图不知道自己被哪个阶段使用，
//   用 useStudentStage() / useTeacherStage() 取当前视图所属阶段（活动原语规格 §2.4）。
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import { coreStudentStore } from '../stores/coreStudentStore.js';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import { effectiveStageConfig, getStageRegistry, useStageSlices } from '../stores/stageStores.js';
import { MirrorContext } from '../mirror/mirrorContext.js';
import { PageStageContext } from '../layout/pageContext.js';
import { useKernelRole } from './roleContext.js';

const EMPTY = Object.freeze({});
const EMPTY_LIST = Object.freeze([]);
const ALERT_INTERVAL_MS = 1000;

// v0.8：options 取 core store 的 classroom:state.stages[i].options——教师 hook 取教师 store；学生 hook 取本端 store
// （镜像在教师端渲染时取教师 store）。stage 为有效 config（原语阶段合并了原语的 layout / collect / subPhases / alerts，并带 options）；
// 学生端 options 不含保密选项，依赖它们的项（如 vote 的 subPhases）在学生端缺省，子阶段以返回的 subPhase 为准
export function useStageConfig(id, forceRole) {
  const kernelRole = useKernelRole();
  const ctx = useContext(PageStageContext);
  if (id == null) id = (ctx && ctx.config && ctx.config.id) || null;
  const role = forceRole || kernelRole;
  const studentStages = coreStudentStore((s) => s.stages);
  const teacherStages = coreTeacherStore((s) => s.stages);
  const list = role === 'teacher' ? teacherStages : studentStages;
  const pub = Array.isArray(list) ? list.find((s) => s && s.id === id) : null;
  const options = (pub && pub.options) ?? null;
  // P2：原语阶段的 sandbox 由服务端下发（classroom:state.stages[i].sandbox），并入有效 config 供 sandbox 组件读 stage.sandbox
  const sandbox = pub ? pub.sandbox : undefined;
  const entry = getStageRegistry().byId[id];
  return { id, stage: entry ? effectiveStageConfig(entry, options, sandbox) : null, options };
}

const TEACHER_RESERVED_PREFIX = ['teacher:advance', 'teacher:join', 'teacher:admin-'];
const TEACHER_RESERVED_EXACT = new Set([
  'teacher:import-roster', 'teacher:clear-roster', 'teacher:reset-classroom',
  'teacher:release-binding', 'teacher:get-student-detail', 'teacher:student-detail',
]);
const STUDENT_RESERVED_PREFIX = ['student:join', 'student:request-claim-release'];
const STUDENT_RESERVED_EXACT = new Set(['student:switch-name']);

export function isReservedEvent(event) {
  if (typeof event !== 'string') return false;
  if (TEACHER_RESERVED_EXACT.has(event) || STUDENT_RESERVED_EXACT.has(event)) return true;
  return TEACHER_RESERVED_PREFIX.some((p) => event.startsWith(p))
    || STUDENT_RESERVED_PREFIX.some((p) => event.startsWith(p));
}

function makeSend(prefix) {
  return (event, payload) => {
    if (typeof event !== 'string' || !event.startsWith(prefix)) {
      throw new Error(`[send] 只允许 ${prefix}* 事件：${event}`);
    }
    if (isReservedEvent(event)) {
      throw new Error(`[send] ${event} 是内核保留事件，阶段视图不能直接发送`);
    }
    socket.emit(event, payload);
  };
}
const studentSend = makeSend('student:');
const teacherSend = makeSend('teacher:');

function teacherAdvance({ force } = {}) {
  coreTeacherStore.getState().advance(force === true);
}

function mirrorSend(event) {
  console.warn(`[mirror] 镜像为只读，忽略 send(${JSON.stringify(event)})`);
}

function initialStudentSlice(id) {
  const entry = getStageRegistry().byId[id];
  const def = entry && entry.store && entry.store.student;
  return def && 'initial' in def ? def.initial : undefined;
}

export function useStudentStage(stageId) {
  const { id, stage, options } = useStageConfig(stageId);
  const mirror = useContext(MirrorContext);
  const role = useKernelRole();
  const liveStage = coreStudentStore((s) => s.stage);
  const liveSubPhase = coreStudentStore((s) => s.subPhase);
  const teacherStage = coreTeacherStore((s) => s.stage);
  const teacherSubPhase = coreTeacherStore((s) => s.subPhase);
  const me = coreStudentStore((s) => s.me);
  const myData = coreStudentStore((s) => s.myStageData[id]);
  const classData = coreStudentStore((s) => s.classData[id]);
  const slice = useStageSlices((s) => s.student[id]);
  if (mirror) {
    const cur = role === 'teacher' ? teacherStage : liveStage;
    const sp = role === 'teacher' ? teacherSubPhase : liveSubPhase;
    const mirrorLive = id === cur;
    return {
      stage,
      subPhase: mirrorLive ? sp : null,
      isLive: mirrorLive,
      me: mirror.me,
      myData: mirror.record,
      classData: mirror.classData ?? EMPTY,
      send: mirrorSend,
      slice: initialStudentSlice(id),
      readOnly: true,
      options,
    };
  }
  const isLive = id === liveStage;
  return {
    stage,
    subPhase: isLive ? liveSubPhase : null,
    isLive,
    me,
    myData,
    classData: classData ?? EMPTY,
    send: studentSend,
    slice,
    readOnly: false,
    options,
  };
}

// ── 提醒 ─────────────────────────────────────────────
// 契约 §二：提醒项为 { id, when(s, now), text }，when 返回真即命中
export function predicateOf(def) {
  return def && typeof def.when === 'function' ? def.when : null;
}

// 对 roster 中在线学生求值：s = { ...rosterEntry, ...perStudent[name] }；names 为空的项不返回
export function evaluateAlerts(defs, roster, perStudent, now, getPredicate = predicateOf) {
  if (!Array.isArray(defs) || defs.length === 0) return [];
  const online = (Array.isArray(roster) ? roster : []).filter((r) => r && r.connected === true);
  const out = [];
  for (const def of defs) {
    if (!def) continue;
    const pred = getPredicate(def);
    if (typeof pred !== 'function') continue;
    const names = [];
    let failed = false;
    for (const entry of online) {
      const s = { ...entry, ...((perStudent && perStudent[entry.name]) || {}) };
      try {
        if (pred(s, now)) names.push(entry.name);
      } catch (err) {
        console.error(`[alerts:${def.id}]`, err);
        failed = true;
        break;
      }
    }
    if (!failed && names.length > 0) out.push({ id: def.id, text: def.text, names });
  }
  return out;
}

function sameAlerts(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text) return false;
    if (a[i].names.join('\u0000') !== b[i].names.join('\u0000')) return false;
  }
  return true;
}

function useAlerts(isLive, defs, roster, perStudent) {
  const [alerts, setAlerts] = useState(EMPTY_LIST);
  const inputs = useRef({ defs, roster, perStudent });
  inputs.current = { defs, roster, perStudent };

  const tick = useCallback(() => {
    const { defs: d, roster: r, perStudent: p } = inputs.current;
    const next = evaluateAlerts(d, r, p, Date.now());
    setAlerts((prev) => (sameAlerts(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    if (!isLive || !Array.isArray(defs) || defs.length === 0) {
      setAlerts((prev) => (prev.length === 0 ? prev : EMPTY_LIST));
      return undefined;
    }
    tick();
    const t = setInterval(tick, ALERT_INTERVAL_MS);
    return () => clearInterval(t);
  }, [isLive, defs, tick]);

  return isLive ? alerts : EMPTY_LIST;
}

export function useTeacherStage(stageId) {
  const { id, stage, options } = useStageConfig(stageId, 'teacher');
  const liveStage = coreTeacherStore((s) => s.stage);
  const liveSubPhase = coreTeacherStore((s) => s.subPhase);
  const roster = coreTeacherStore((s) => s.roster);
  const stageData = coreTeacherStore((s) => s.stageData[id]);
  const slice = useStageSlices((s) => s.teacher[id]);
  const isLive = id === liveStage;
  const perStudent = (stageData && stageData.perStudent) || EMPTY;
  const perClass = (stageData && stageData.perClass) || EMPTY;
  const alerts = useAlerts(isLive, stage && stage.alerts, roster, perStudent);
  return {
    stage,
    subPhase: isLive ? liveSubPhase : null,
    isLive,
    roster,
    perStudent,
    perClass,
    send: teacherSend,
    advance: teacherAdvance,
    slice,
    alerts,
    options,
  };
}
