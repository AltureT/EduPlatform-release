// 课堂状态（规格 §5）：纯内存；持久化由 persistence.js 与调用方负责
// students: Map<name, { name, socketId, connected, joinedAt, lastSeen, deviceId, enteredStageAt, enteredStageIndex }>
// roster: Map<name, ordinal>；deviceBindings / deviceByName；currentIndex；subPhase；stageData；classEpoch；advancing
import { stagesHash as computeStagesHash } from './stage-loader.js';
import { MAX_NAME_LENGTH } from './roster.js';

export const PRELOGIN = 'prelogin';
export const CURTAIN = 'curtain';

export function projectStudent(s) {
  return {
    name: s.name,
    connected: !!s.connected,
    enteredStageAt: s.enteredStageAt ?? null,
    enteredStageIndex: s.enteredStageIndex ?? null,
  };
}

// 裁决（已接受）：lesson.config.curtain.label 缺省时回退为 '总结'
const publicCurtainLabel = (lesson) => lesson?.curtain?.label ?? '总结';

// 匿名代号（规格 v0.5 §2.2 anon）：第 n 个（从 0 起）→ "同学 A" … "同学 Z"、"同学 AA"、"同学 AB" …
export function anonLabel(n) {
  let k = n + 1;
  let s = '';
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return `同学 ${s}`;
}

// components：component-loader 的结果 [{ id, label, options, dir, register? }]（v0.5，缺省 []）
export function createState({ lesson, stages, components }) {
  const lessonStages = stages || [];
  const lessonComponents = components || [];
  const stageIds = [PRELOGIN, ...lessonStages.map((s) => s.id), CURTAIN];
  const configById = new Map(lessonStages.map((s) => [s.id, s.config]));
  // v0.8：options（原语阶段为加载时校验过的对象，非原语阶段 null）与 layout（有效值，缺省 focus；内核阶段 null）
  // 保密选项（原语 primitive.config.secretOptions，加载器放在 stages[i].secretOptions）：教师版完整，学生版去掉这些键。
  // getPublicState() 缺省给学生版——连接时角色未知、学生 join-ok、广播给学生都用它；只有教师 join-ok 与发往教师房间的用 'teacher'
  const stripSecret = (s) => {
    const opts = s.config.primitive != null ? (s.config.options ?? null) : null;
    const secret = Array.isArray(s.secretOptions) ? s.secretOptions : [];
    if (!opts || secret.length === 0) return opts;
    return Object.fromEntries(Object.entries(opts).filter(([k]) => !secret.includes(k)));
  };
  const makePublicStages = (teacher) => [
    { id: PRELOGIN, label: '课前', hasDemo: false, primitive: null, components: [], collect: null, options: null, layout: null },
    ...lessonStages.map((s) => ({
      id: s.id,
      label: s.config.label,
      hasDemo: !!s.hasDemo,
      primitive: s.config.primitive ?? null,
      components: s.config.components ?? [],
      collect: s.config.collect ?? null,
      options: teacher ? (s.config.primitive != null ? (s.config.options ?? null) : null) : stripSecret(s),
      layout: s.config.layout ?? 'focus',
      // 原语阶段的有效 sandbox 配置（原语 defaults.sandbox(options)），师生同一份；前端打包的 stage.config 没有 options，
      // 算不出它，只能由服务端下发。非原语阶段不占字段（照旧从自己的 stage.config.sandbox 读）
      ...(s.config.primitive != null && s.config.sandbox !== undefined ? { sandbox: s.config.sandbox } : {}),
    })),
    {
      id: CURTAIN, label: publicCurtainLabel(lesson), hasDemo: false, primitive: null, components: [], collect: null, options: null, layout: null,
    },
  ];
  const publicStagesByRole = { student: makePublicStages(false), teacher: makePublicStages(true) };

  // v0.5：{ id, label, options, stages }；stages = 在 stage.config.components 里列出本组件的阶段 id，
  // 没有任何阶段列出时为 null（全阶段显示）
  const publicComponents = lessonComponents.map((c) => {
    const listed = lessonStages
      .filter((s) => Array.isArray(s.config.components) && s.config.components.includes(c.id))
      .map((s) => s.id);
    return { id: c.id, label: c.label, options: c.options ?? {}, stages: listed.length > 0 ? listed : null };
  });

  // 规格 v0.4.1：getPublicState 带出 lesson.config.curtain 与 lesson.config.roster.mode
  const publicCurtain = {
    label: publicCurtainLabel(lesson),
    override: lesson?.curtain?.override ?? null,
  };
  // roster.mode 缺省或非法时按 'roster'（与 lesson.config 示例一致）；运行时 rosterMode 仍由 roster.size > 0 推导
  const rosterDefault = lesson?.roster?.mode === 'free' ? 'free' : 'roster';

  const students = new Map();
  const roster = new Map();
  const deviceBindings = new Map(); // deviceId → name
  const deviceByName = new Map(); // name → deviceId
  // stageData: Map<stageId, { perStudent: Map<name, record>, perClass: record | null }>
  const stageData = new Map();
  // 匿名代号表：name → 代号；推进与重置时清空，不持久化
  const anonCodes = new Map();

  const bucket = (stageId) => {
    let b = stageData.get(stageId);
    if (!b) {
      b = { perStudent: new Map(), perClass: null };
      stageData.set(stageId, b);
    }
    return b;
  };

  const state = {
    lesson,
    lessonId: lesson?.id,
    stagesHash: computeStagesHash(lessonStages.map((s) => s.id)),
    stageIds,
    lessonStages,
    studentMap: students,
    rosterMap: roster,
    currentIndex: 0,
    subPhase: null,
    classEpoch: null,
    advancing: false,

    get currentStage() {
      return stageIds[state.currentIndex];
    },
    stageConfig(id) {
      return configById.get(id) ?? null;
    },
    isLessonStage(id) {
      return configById.has(id);
    },
    components: lessonComponents,

    // ===== 匿名代号（v0.5）=====
    anon: {
      code(name) {
        let c = anonCodes.get(name);
        if (c === undefined) {
          c = anonLabel(anonCodes.size);
          anonCodes.set(name, c);
        }
        return c;
      },
      clear() {
        anonCodes.clear();
      },
    },

    // ===== 学生 =====
    addStudent(name, socketId, deviceId = null) {
      if (typeof name !== 'string' || name.trim().length === 0) return { error: '请输入姓名' };
      const trimmed = name.trim();
      if (trimmed.length > MAX_NAME_LENGTH) return { error: '姓名过长' };
      const now = Date.now();

      const existing = students.get(trimmed);
      if (existing) {
        // 同设备同名重连（刷新时旧 socket 的 disconnect 可能还没到）→ 复用原记录
        const sameDeviceRejoin = !!deviceId && deviceByName.get(trimmed) === deviceId;
        if (existing.connected && !sameDeviceRejoin) {
          let suffix = 2;
          while (students.has(`${trimmed} (${suffix})`)) suffix++;
          const finalName = `${trimmed} (${suffix})`;
          const student = {
            name: finalName, socketId, connected: true, joinedAt: now, lastSeen: now,
            deviceId: deviceId || null, enteredStageAt: null, enteredStageIndex: null,
          };
          students.set(finalName, student);
          return { student, renamed: true, rejoin: false };
        }
        // 原会话已断线（或同设备）→ 复活
        existing.socketId = socketId;
        existing.connected = true;
        existing.lastSeen = now;
        if (deviceId) existing.deviceId = deviceId;
        return { student: existing, rejoin: true, renamed: false };
      }
      const student = {
        name: trimmed, socketId, connected: true, joinedAt: now, lastSeen: now,
        deviceId: deviceId || null, enteredStageAt: null, enteredStageIndex: null,
      };
      students.set(trimmed, student);
      return { student, rejoin: false, renamed: false };
    },
    // 从持久化恢复（全部离线）
    rehydrateStudent(row) {
      students.set(row.name, {
        name: row.name,
        socketId: null,
        connected: false,
        joinedAt: row.joinedAt ?? null,
        lastSeen: row.lastSeen ?? null,
        deviceId: deviceByName.get(row.name) ?? null,
        enteredStageAt: row.enteredStageAt ?? null,
        enteredStageIndex: row.enteredStageIndex ?? null,
      });
    },
    getStudent(name) {
      return students.get(name);
    },
    markDisconnected(name) {
      const s = students.get(name);
      if (!s) return;
      s.connected = false;
      s.lastSeen = Date.now();
    },
    removeStudent(name) {
      students.delete(name);
    },
    students() {
      return Array.from(students.values(), projectStudent);
    },
    connected() {
      return Array.from(students.values()).filter((s) => s.connected).map(projectStudent);
    },
    counts() {
      let online = 0;
      for (const s of students.values()) if (s.connected) online++;
      return { online, total: students.size };
    },
    // 契约 §六：enteredStageIndex !== currentIndex 时写入并记 firstEntry
    enterStudentIfNeeded(name, now = Date.now()) {
      const s = students.get(name);
      if (!s) return { firstEntry: false };
      if (s.enteredStageIndex !== state.currentIndex) {
        s.enteredStageAt = now;
        s.enteredStageIndex = state.currentIndex;
        return { firstEntry: true };
      }
      return { firstEntry: false };
    },
    // 持久化行
    studentRow(name) {
      const s = students.get(name);
      if (!s) return null;
      return {
        name: s.name, joinedAt: s.joinedAt, lastSeen: s.lastSeen,
        enteredStageAt: s.enteredStageAt ?? null, enteredStageIndex: s.enteredStageIndex ?? null,
      };
    },

    // ===== 名单 =====
    isRosterMode() {
      return roster.size > 0;
    },
    getRosterNames() {
      return Array.from(roster.entries()).sort((a, b) => a[1] - b[1]).map(([n]) => n);
    },
    rehydrateRoster(rows) {
      roster.clear();
      for (const r of rows || []) {
        if (r && typeof r.name === 'string') roster.set(r.name, r.ordinal ?? roster.size);
      }
    },
    setRoster(names) {
      roster.clear();
      let i = 0;
      for (const n of names || []) {
        const t = typeof n === 'string' ? n.trim() : '';
        if (t && t.length <= MAX_NAME_LENGTH && !roster.has(t)) roster.set(t, i++);
      }
      return roster.size;
    },
    clearRoster() {
      roster.clear();
    },

    // ===== 设备绑定 =====
    rehydrateDeviceBindings(rows) {
      deviceBindings.clear();
      deviceByName.clear();
      for (const r of rows || []) {
        if (!r || typeof r.deviceId !== 'string' || typeof r.studentName !== 'string') continue;
        deviceBindings.set(r.deviceId, r.studentName);
        deviceByName.set(r.studentName, r.deviceId);
      }
    },
    getDeviceBinding(deviceId) {
      return deviceBindings.get(deviceId) || null;
    },
    getDeviceByName(name) {
      return deviceByName.get(name) || null;
    },
    bindDevice(deviceId, name) {
      // 同步两张反向表，先清掉旧映射以免留下孤儿
      const prevName = deviceBindings.get(deviceId);
      if (prevName && prevName !== name) deviceByName.delete(prevName);
      const prevDevice = deviceByName.get(name);
      if (prevDevice && prevDevice !== deviceId) deviceBindings.delete(prevDevice);
      deviceBindings.set(deviceId, name);
      deviceByName.set(name, deviceId);
    },
    clearAllDeviceBindings() {
      deviceBindings.clear();
      deviceByName.clear();
    },
    removeDeviceBindingByName(name) {
      const did = deviceByName.get(name);
      if (did) deviceBindings.delete(did);
      deviceByName.delete(name);
    },
    getClaimedNames() {
      return Array.from(deviceByName.keys());
    },

    // ===== 公共状态 =====
    // role：'student'（缺省）| 'teacher'；两者只在原语阶段的保密选项上不同（v0.8）
    getPublicState(role = 'student') {
      const publicStages = publicStagesByRole[role === 'teacher' ? 'teacher' : 'student'];
      return {
        lessonId: lesson?.id,
        title: lesson?.title,
        glyph: lesson?.glyph,
        theme: lesson?.theme ?? {},
        stage: state.currentStage,
        stageIndex: state.currentIndex,
        subPhase: state.subPhase,
        stages: publicStages,
        students: state.students(),
        counts: state.counts(),
        rosterMode: state.isRosterMode(),
        rosterNames: state.getRosterNames(),
        claimedNames: state.getClaimedNames(),
        classEpoch: state.classEpoch,
        // v0.4.1
        curtain: publicCurtain,
        rosterDefault,
        // v0.5
        components: publicComponents,
      };
    },

    // ===== 阶段 =====
    // 索引推进与 enteredStage* 批量写；gate / 钩子 / 广播 / 持久化由调用方负责
    advance(now = Date.now()) {
      if (state.currentStage === CURTAIN) throw new Error('already at curtain');
      state.currentIndex += 1;
      anonCodes.clear();
      const cfg = configById.get(state.currentStage);
      state.subPhase = cfg?.subPhases?.[0] ?? null;
      for (const s of students.values()) {
        if (s.connected) {
          s.enteredStageAt = now;
          s.enteredStageIndex = state.currentIndex;
        } else {
          s.enteredStageAt = null;
          s.enteredStageIndex = null;
        }
      }
      return { stage: state.currentStage, stageIndex: state.currentIndex, enteredStageAt: now };
    },
    setSubPhase(x) {
      if (x !== null && typeof x !== 'string') throw new Error('subPhase must be a string or null');
      const list = configById.get(state.currentStage)?.subPhases;
      if (x !== null && Array.isArray(list) && !list.includes(x)) {
        throw new Error(`subPhase "${x}" not in [${list.join(', ')}]`);
      }
      state.subPhase = x;
    },

    // ===== 阶段数据 =====
    data: {
      get(stageId, name) {
        return stageData.get(stageId)?.perStudent.get(name);
      },
      set(stageId, name, record) {
        bucket(stageId).perStudent.set(name, record);
      },
      all(stageId) {
        const b = stageData.get(stageId);
        return b ? Object.fromEntries(b.perStudent) : {};
      },
      getClass(stageId) {
        return stageData.get(stageId)?.perClass ?? {};
      },
      setClass(stageId, record) {
        bucket(stageId).perClass = record;
      },
      // join-ok.myStageData：{ [stageId]: record }
      myStageData(name) {
        const out = {};
        for (const [id, b] of stageData) {
          const r = b.perStudent.get(name);
          if (r !== undefined) out[id] = r;
        }
        return out;
      },
      // join-ok.classData：{ [stageId]: perClass }
      classData() {
        const out = {};
        for (const [id, b] of stageData) if (b.perClass) out[id] = b.perClass;
        return out;
      },
      // teacher:join-ok.stageData：每个课程阶段都给出 { perStudent, perClass }
      teacherStageData() {
        const out = {};
        const ids = new Set([...lessonStages.map((s) => s.id), ...stageData.keys()]);
        for (const id of ids) out[id] = { perStudent: state.data.all(id), perClass: state.data.getClass(id) };
        return out;
      },
      clear() {
        stageData.clear();
      },
    },

    // teacher:reset-classroom：清学生 / 绑定 / 阶段数据，保留名单；阶段回 0
    reset(epoch) {
      students.clear();
      deviceBindings.clear();
      deviceByName.clear();
      stageData.clear();
      anonCodes.clear();
      state.currentIndex = 0;
      state.subPhase = null;
      state.advancing = false;
      state.classEpoch = epoch;
    },
  };
  return state;
}
