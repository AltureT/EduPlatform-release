// share 组件服务端（可选组件规格 §3.2、§2.5）
// 隐私：被帮助学生的真名只写 actions；peerHelp 只存匿名代号，且只落在 helper 本人的记录里
import { shape } from '#kernel/server/schema.js';

export const NEED_MANUAL = '本阶段需要手选被帮助的学生';

// §2.5：只对"在线、有本阶段记录、不是 helper"的学生调用 score；null / 非数字排除；
// 按 score 升序取前 max(1, ceil(n/3)) 人再随机一位；n = 0 返回 null
export function pickStruggling({ score, connected, stageData, helper, random = Math.random }) {
  const scored = [];
  for (const s of connected) {
    if (s.name === helper) continue;
    const record = stageData.get(s.name);
    if (record == null) continue;
    let v;
    try {
      v = score(record);
    } catch {
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    scored.push({ name: s.name, v });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => a.v - b.v);
  const k = Math.max(1, Math.ceil(scored.length / 3));
  const i = Math.min(k - 1, Math.max(0, Math.floor(random() * k)));
  return scored[i].name;
}

export function register(cctx) {
  const random = typeof cctx.options?.random === 'function' ? cctx.options.random : Math.random;
  const isOnline = (name) => cctx.state.connected().some((s) => s.name === name);
  const exists = (name) => cctx.state.students().some((s) => s.name === name);
  const stageConfig = (stageId) => cctx.stages.list().find((s) => s.id === stageId)?.config ?? {};

  cctx.on('share:t-invite', shape({ name: 'string', stageId: 'string' }), (socket, { name, stageId }) => {
    if (stageId !== cctx.state.currentStage) return cctx.reject(socket, '只能在当前阶段邀请');
    if (!isOnline(name)) return cctx.reject(socket, '该学生不在线');
    cctx.data.setClass({ spotlight: { name, stageId, at: Date.now() } });
    cctx.actions.append('spotlight', { name, stageId });
  });

  cctx.on('share:t-clear', shape({}), () => {
    cctx.data.setClass({ spotlight: null });
  });

  cctx.on(
    'share:t-peer-help',
    shape({ helper: 'string', stageId: 'string', struggling: 'optional:string' }),
    (socket, { helper, stageId, struggling }) => {
      if (stageId !== cctx.state.currentStage) return cctx.reject(socket, '只能在当前阶段邀请');
      if (!isOnline(helper)) return cctx.reject(socket, '该学生不在线');
      const stageData = cctx.stages.data(stageId);
      let target = struggling;
      if (target != null) {
        if (!exists(target)) return cctx.reject(socket, '被帮助的学生不存在');
      } else {
        const { score } = stageConfig(stageId);
        if (typeof score !== 'function') return cctx.reject(socket, NEED_MANUAL);
        target = pickStruggling({ score, connected: cctx.state.connected(), stageData, helper, random });
        if (target == null) return cctx.reject(socket, '没有可选的被帮助学生');
      }
      if (target === helper) return cctx.reject(socket, '不能帮助自己');
      cctx.data.set(helper, {
        peerHelp: {
          code: cctx.anon.code(target),
          stageId,
          record: stageData.get(target) ?? {},
          classData: stageData.getClass(),
          at: Date.now(),
        },
      });
      cctx.actions.append('peer-help', { helper, struggling: target, stageId });
    },
  );

  cctx.on('share:t-peer-help-clear', shape({ helper: 'string' }), (socket, { helper }) => {
    cctx.data.set(helper, { peerHelp: null });
  });

  cctx.hooks.onStageChange(() => {
    cctx.data.setClass({ spotlight: null });
    for (const [name, record] of Object.entries(cctx.data.all())) {
      if (record?.peerHelp) cctx.data.set(name, { peerHelp: null });
    }
  });
}
