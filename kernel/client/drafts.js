// 学生输入自动保存（学生输入自动保存规格 §2.2、§5；契约 §四"学生输入自动保存（useDraft）"、§八）
//
// useDraft(field, initial, { stageId, local = true, server = true } = {}) → [value, setValue, { clear, restored }]
// - 两层：本地 localStorage（防抖 300 ms）+ 服务端 student:draft-set（防抖 2 s）；卸载与 pagehide 时立即写本地并发一次服务端
// - 读取顺序：本地草稿 → 服务端草稿（join-ok.myDrafts）→ initial（调用方把"已提交记录"算进 initial）
// - stageId 缺省取外壳给本视图的阶段（PageStageContext）；组件传 'component:<id>'
// - field 须匹配 /^[a-z][a-z0-9_-]{0,39}$/，否则抛错；value 须可 JSON 化，序列化后 > 64 KB 只存本地（console.warn 一次）；
//   本人全部服务端草稿（按 store.myDrafts 估算）合计会超过 1 MB 时同样不发（console.warn 一次）——服务端对超量静默丢弃
// - 教师端 / 镜像只读视图 / 没有 me.name / 没有 stageId：退化为普通 useState（不读不写）
// - restored：'local' | 'server' | null（本次值从哪层恢复）
// - clear()：删本地与服务端（发 student:draft-set { value: null }），值回到 initial。
//   D1 审查：没连上时发不出删除——本地键写墓碑 { $del: 1 }，读取时见墓碑本地与服务端都不读、直接用 initial；
//   能发时（挂载时或重新连上）补发一次 value: null 再删墓碑
// - 服务端写只在已连上且已回灌（hydrated）时发；断线期间的改动留在本地，重连重挂后与服务端不一致时补发；
//   与上次已发给服务端（或服务端现有）的值相同时不发
// - 课堂重置（classroom:reset）后不再写（重置代数），coreStudentStore 同时清掉本课 draft: 与 sandbox: 前缀
// 草稿只给本人：教师端、镜像、报告、导出都不读
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { socket } from './socket.js';
import { coreStudentStore } from './stores/coreStudentStore.js';
import { useKernelRole } from './hooks/roleContext.js';
import { MirrorContext } from './mirror/mirrorContext.js';
import { PageStageContext } from './layout/pageContext.js';
import {
  DRAFT_FIELD_RE, draftKey, readDraft, writeDraft, clearDraft, draftGeneration,
} from './stores/draftStorage.js';

export { draftKey, readDraft, writeDraft, clearDraft, clearLessonDrafts, DRAFT_FIELD_RE } from './stores/draftStorage.js';

export const DRAFT_LOCAL_MS = 300;
export const DRAFT_SERVER_MS = 2000;
export const DRAFT_SERVER_MAX = 64 * 1024;
export const DRAFT_TOTAL_MAX = 1024 * 1024;
export const DRAFT_TOMBSTONE = Object.freeze({ $del: 1 });

export const isTombstone = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && v.$del === 1 && Object.keys(v).length === 1;

const byteLength = (s) => {
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length * 3;
  }
};
const toJson = (v) => JSON.stringify(v === undefined ? null : v);

function serverDraftOf(stageId, field) {
  const all = coreStudentStore.getState().myDrafts;
  const sd = all && all[stageId];
  return sd && Object.prototype.hasOwnProperty.call(sd, field) ? { value: sd[field] } : null;
}

// 本人服务端草稿（store 里的副本）除 (stageId, field) 以外的字节数
function serverBytesExcept(stageId, field) {
  const all = coreStudentStore.getState().myDrafts || {};
  let n = 0;
  for (const [sid, fields] of Object.entries(all)) {
    for (const [f, v] of Object.entries(fields || {})) {
      if (sid === stageId && f === field) continue;
      n += byteLength(toJson(v));
    }
  }
  return n;
}

function setServerDraftInStore(stageId, field, value) {
  coreStudentStore.setState((s) => {
    const all = { ...(s.myDrafts || {}) };
    const sd = { ...(all[stageId] || {}) };
    if (value === null) delete sd[field];
    else sd[field] = value;
    if (Object.keys(sd).length) all[stageId] = sd;
    else delete all[stageId];
    return { myDrafts: all };
  });
}

export function useDraft(field, initial, opts = {}) {
  if (typeof field !== 'string' || !DRAFT_FIELD_RE.test(field)) {
    throw new Error(`[useDraft] 字段名须是小写字母开头、只含小写字母 / 数字 / _ / -，最长 40：${field}`);
  }
  const { stageId: explicitStage, local = true, server = true } = opts || {};
  const role = useKernelRole();
  const mirror = useContext(MirrorContext);
  const page = useContext(PageStageContext);
  const stageId = explicitStage ?? (page && page.config && page.config.id) ?? null;
  const name = coreStudentStore((s) => (s.me && s.me.name) || null);
  const lessonId = coreStudentStore((s) => (s.lesson && s.lesson.id) || null);
  const classEpoch = coreStudentStore((s) => s.classEpoch ?? null);
  const live = coreStudentStore((s) => !!(s.connected && s.hydrated));
  const active = role === 'student' && !mirror && !!name && !!stageId;
  // tKey：本地键；local:false 时不存值，只用来放墓碑
  const tKey = active ? draftKey({ lessonId, classEpoch, name, stageId, field }) : null;
  const key = local ? tKey : null;
  const ident = active ? `${lessonId}\u0000${classEpoch}\u0000${name}\u0000${stageId}\u0000${field}\u0000${local}\u0000${server}` : null;

  const compute = () => {
    if (active && tKey) {
      const v = readDraft(tKey);
      if (isTombstone(v)) return { ident, value: initial, restored: null, tomb: true };
      if (key && v !== undefined) return { ident, value: v, restored: 'local' };
    }
    if (active && server) {
      const sd = serverDraftOf(stageId, field);
      if (sd) return { ident, value: sd.value, restored: 'server' };
    }
    return { ident, value: initial, restored: null };
  };
  const [st, setSt] = useState(compute);
  let cur = st;
  if (st.ident !== ident) {
    cur = compute();
    setSt(cur);
  }

  const valueRef = useRef(cur.value);
  valueRef.current = cur.value;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const ctx = useRef(null);
  ctx.current = { active, key, tKey, stageId, field, name, local, server, ident, restored: cur.restored, tomb: !!cur.tomb };
  const w = useRef({
    gen: draftGeneration(), localTimer: null, serverTimer: null, pendingLocal: undefined, serverDirty: false,
    warned: false, warnedTotal: false, lastSent: undefined, tombPending: false,
  });

  const alive = () => ctx.current.active && w.current.gen === draftGeneration();
  const canSend = () => {
    const s = coreStudentStore.getState();
    return !!(s.connected && s.hydrated && s.me && s.me.name === ctx.current.name);
  };

  const flushLocal = useCallback(() => {
    const x = w.current;
    if (x.localTimer) clearTimeout(x.localTimer);
    x.localTimer = null;
    if (x.pendingLocal === undefined) return;
    const v = x.pendingLocal;
    x.pendingLocal = undefined;
    if (!alive() || !ctx.current.key) return;
    writeDraft(ctx.current.key, v);
  }, []);

  // 墓碑：能发时补发一次 value: null，再删墓碑（本地键里若已被新值覆盖则不动）
  const sendTomb = useCallback(() => {
    const x = w.current;
    if (!x.tombPending || !alive() || !ctx.current.server || !canSend()) return;
    const { stageId: sid, field: f, tKey: tk } = ctx.current;
    socket.emit('student:draft-set', { stageId: sid, field: f, value: null });
    setServerDraftInStore(sid, f, null);
    x.lastSent = undefined;
    x.tombPending = false;
    if (tk && isTombstone(readDraft(tk))) clearDraft(tk);
  }, []);

  const flushServer = useCallback(() => {
    const x = w.current;
    if (x.serverTimer) clearTimeout(x.serverTimer);
    x.serverTimer = null;
    if (!x.serverDirty) return;
    if (!alive() || !ctx.current.server) {
      x.serverDirty = false;
      return;
    }
    if (!canSend()) return; // 留着：重连重挂后与本地比对补发
    x.serverDirty = false;
    const v = valueRef.current;
    const json = toJson(v);
    const { stageId: sid, field: f, tKey: tk, local: loc } = ctx.current;
    const bytes = byteLength(json);
    if (bytes > DRAFT_SERVER_MAX) {
      if (!x.warned) {
        x.warned = true;
        console.warn(`[useDraft] ${sid}/${f} 超过 64 KB，只存本地`);
      }
      return;
    }
    if (serverBytesExcept(sid, f) + bytes > DRAFT_TOTAL_MAX) {
      if (!x.warnedTotal) {
        x.warnedTotal = true;
        console.warn(`[useDraft] 本人草稿合计会超过 1 MB，${sid}/${f} 只存本地`);
      }
      return;
    }
    socket.emit('student:draft-set', { stageId: sid, field: f, value: json });
    setServerDraftInStore(sid, f, v === undefined ? null : v);
    x.lastSent = json;
    // 新值已覆盖服务端：墓碑作废（local 时本地键已由新值覆盖；local:false 时删掉只放墓碑的键）
    if (x.tombPending) {
      x.tombPending = false;
      if (!loc && tk && isTombstone(readDraft(tk))) clearDraft(tk);
    }
  }, []);

  const flushAll = useCallback(() => {
    flushLocal();
    flushServer();
  }, [flushLocal, flushServer]);

  const scheduleServer = useCallback((ms = DRAFT_SERVER_MS) => {
    const x = w.current;
    x.serverDirty = true;
    if (x.serverTimer) clearTimeout(x.serverTimer);
    x.serverTimer = setTimeout(flushServer, ms);
  }, [flushServer]);

  const setValue = useCallback((next) => {
    const v = typeof next === 'function' ? next(valueRef.current) : next;
    valueRef.current = v;
    const c = ctx.current;
    setSt((prev) => ({ ident: c.ident, value: v, restored: prev.restored }));
    if (!alive()) return;
    const x = w.current;
    if (c.key) {
      x.pendingLocal = v;
      if (x.localTimer) clearTimeout(x.localTimer);
      x.localTimer = setTimeout(flushLocal, DRAFT_LOCAL_MS);
    }
    if (c.server) {
      // 与服务端现有的值相同（如 PyRunner 挂载时把本地草稿交回）：不发，并撤掉还没发的中间值
      if (!x.tombPending && x.lastSent !== undefined && toJson(v) === x.lastSent) {
        if (x.serverTimer) clearTimeout(x.serverTimer);
        x.serverTimer = null;
        x.serverDirty = false;
      } else {
        scheduleServer();
      }
    }
  }, [flushLocal, scheduleServer]);

  const clear = useCallback(() => {
    const x = w.current;
    if (x.localTimer) clearTimeout(x.localTimer);
    if (x.serverTimer) clearTimeout(x.serverTimer);
    x.localTimer = null;
    x.serverTimer = null;
    x.pendingLocal = undefined;
    x.serverDirty = false;
    const c = ctx.current;
    const init = initialRef.current;
    valueRef.current = init;
    setSt({ ident: c.ident, value: init, restored: null });
    if (!alive()) return;
    if (!c.server) {
      if (c.key) clearDraft(c.key);
      return;
    }
    setServerDraftInStore(c.stageId, c.field, null);
    if (canSend()) {
      socket.emit('student:draft-set', { stageId: c.stageId, field: c.field, value: null });
      x.lastSent = undefined;
      x.tombPending = false;
      if (c.tKey) clearDraft(c.tKey);
    } else {
      // 发不出删除：写墓碑，重连后 join-ok 带回的旧值不再回填；能发时补发
      x.tombPending = true;
      if (c.tKey) writeDraft(c.tKey, DRAFT_TOMBSTONE);
    }
  }, []);

  // 挂载 / 身份变化：记下重置代数与服务端现值；有墓碑 → 能发就补发删除；
  // 本地恢复的值与服务端不一致（断线期间改过）→ 补发服务端；卸载即写
  useEffect(() => {
    if (!ident) return undefined;
    const x = w.current;
    x.gen = draftGeneration();
    const c = ctx.current;
    const sd = c.server ? serverDraftOf(c.stageId, c.field) : null;
    x.lastSent = sd ? toJson(sd.value) : undefined;
    x.tombPending = c.server && c.tomb;
    if (x.tombPending) sendTomb();
    else if (c.server && c.restored === 'local' && (!sd || toJson(sd.value) !== toJson(valueRef.current))) scheduleServer();
    return () => flushAll();
  }, [ident, flushAll, scheduleServer, sendTomb]);

  // 挂着时重新连上（断线期间视图没卸载）：补发墓碑与还没发出去的改动
  useEffect(() => {
    if (!ident || !live) return;
    sendTomb();
    if (w.current.serverDirty && !w.current.serverTimer) scheduleServer(0);
  }, [ident, live, sendTomb, scheduleServer]);

  useEffect(() => {
    if (!ident || typeof window === 'undefined') return undefined;
    window.addEventListener('pagehide', flushAll);
    return () => window.removeEventListener('pagehide', flushAll);
  }, [ident, flushAll]);

  const plainSet = useCallback((next) => {
    setSt((prev) => ({ ...prev, value: typeof next === 'function' ? next(prev.value) : next }));
  }, []);
  const plainClear = useCallback(() => {
    setSt((prev) => ({ ...prev, value: initialRef.current, restored: null }));
  }, []);

  return active
    ? [cur.value, setValue, { clear, restored: cur.restored }]
    : [cur.value, plainSet, { clear: plainClear, restored: null }];
}

export default useDraft;
