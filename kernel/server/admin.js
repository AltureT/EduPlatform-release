// 管理事件与端点（规格 §5.2 设备治理、§5.3）
// socket：teacher:import-roster / clear-roster / reset-classroom / get-student-detail / release-binding
//   成功回 teacher:admin-ok { action }（详情回 teacher:student-detail），失败回 teacher:admin-error { action, message }
// HTTP：公开 GET /api/roster；教师 token（Authorization: Bearer，U4）GET /api/lan（v0.7：本机局域网 IPv4，供教师课前页二维码）；
//   仅 localhost：POST /api/admin/roster、/roster/clear、/device-bindings/clear、
//   /device-bindings/release、/reset
import os from 'node:os';
import { Router } from 'express';
import { shape } from './schema.js';
import { parseRoster, normalizeNames } from './roster.js';
import { saveSnapshot } from './persistence.js';
import { createLog } from './log.js';

// 管理端口只允许本机（manage.sh 用 curl 127.0.0.1 调）
export function requireLocalhost(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) return res.status(403).json({ error: 'admin endpoint requires localhost' });
  next();
}

// 本机局域网 IPv4 地址，供教师课前页二维码（界面整理规格 §4；U1 审查）：
// - 只返回私有网段 10/8、172.16/12、192.168/16（因此 169.254/16、198.18/15、100.64/10、回环与公网都不返回）
// - 排序：实体网卡在前、虚拟网卡（utun / feth / zt / docker / vboxnet / vmnet / vEthernet / VirtualBox / VMware）在后；
//   同类里 192.168 > 10 > 172.16/12；再按网卡顺序；去重
// ifaces 缺省取 os.networkInterfaces()
const VIRTUAL_IFACE = /^(utun|feth|zt|docker|vboxnet|vmnet|vethernet|virtualbox|vmware)/i;

function privateRank(address) {
  const p = String(address).split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return -1;
  if (p[0] === 192 && p[1] === 168) return 0;
  if (p[0] === 10) return 1;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 2;
  return -1;
}

export function lanAddresses(ifaces = os.networkInterfaces()) {
  const found = [];
  const seen = new Set();
  let order = 0;
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const it of list || []) {
      const v4 = it && (it.family === 'IPv4' || it.family === 4);
      if (!v4 || it.internal || !it.address || seen.has(it.address)) continue;
      const rank = privateRank(it.address);
      if (rank < 0) continue;
      seen.add(it.address);
      found.push({ address: it.address, virtual: VIRTUAL_IFACE.test(name) ? 1 : 0, rank, order: order++ });
    }
  }
  found.sort((x, y) => x.virtual - y.virtual || x.rank - y.rank || x.order - y.order);
  return found.map((f) => f.address);
}

// U4：教师 token（Authorization: Bearer <token>，不接受查询串；与 /api/export.csv 同一规则）
export function requireTeacherToken(tokens) {
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !tokens || !tokens.has(token)) return res.status(401).json({ error: 'unauthorized' });
    next();
  };
}

// onReset：重置时由调用方清空所有学生 socket 的 socket.data（createKernel 提供）
// tokens：教师 token 集合（auth.js 的 tokens）；缺省为空集合（/api/lan 一律 401）
export function createAdmin({ io, state, db, throttle, tokens = new Set(), log = createLog('admin'), onReset }) {
  const rosterPayload = () => ({
    rosterMode: state.isRosterMode(),
    rosterNames: state.getRosterNames(),
    claimedNames: state.getClaimedNames(),
  });

  function replaceRoster(names) {
    const count = db.replaceRoster(names);
    state.setRoster(names);
    io.emit('classroom:roster-mode-update', rosterPayload());
    return count;
  }

  function clearRoster() {
    db.clearRoster();
    state.clearRoster();
    io.emit('classroom:roster-mode-update', rosterPayload());
  }

  function releaseBinding(name) {
    db.deleteDeviceBindingByName(name);
    state.removeDeviceBindingByName(name);
    io.emit('classroom:name-claim-update', { claimedNames: state.getClaimedNames() });
  }

  // 裁决：清空后全员 classroom:reset { reason:'bindings-cleared', message }，再广播 name-claim-update { claimedNames: [] }
  function clearBindings() {
    db.clearDeviceBindings();
    state.clearAllDeviceBindings();
    io.emit('classroom:reset', { reason: 'bindings-cleared', message: '设备绑定已清除，请重新登录' });
    io.emit('classroom:name-claim-update', { claimedNames: state.getClaimedNames() });
  }

  // 规格 §5.3：丢弃节流队列；新 epoch；清 students / device_bindings / stage_*_data（保留 roster、events、actions）；
  // 阶段回 0、subPhase null；清空学生 socket.data（重新 join 前的阶段事件按 forbidden 拒绝）；
  // 全员广播 classroom:reset 与 classroom:state
  function resetClassroom() {
    const oldEpoch = state.classEpoch;
    throttle?.dropAll();
    const epoch = db.resetClassroom();
    state.reset(epoch);
    onReset?.();
    saveSnapshot(state, db);
    db.appendTeacherAction('reset-classroom', null, null, oldEpoch);
    log.info('classroom reset', { epoch });
    io.emit('classroom:reset', { reason: 'teacher-reset' });
    // v0.8：保密选项只发给教师房间；其余 socket（学生与未登录）收学生版
    io.to('teacher').emit('classroom:state', state.getPublicState('teacher'));
    io.except('teacher').emit('classroom:state', state.getPublicState());
  }

  const handlers = {
    'teacher:import-roster': {
      action: 'import-roster',
      schema: shape({ text: 'optional:string', names: 'optional:array:string' }),
      run(socket, { text, names }) {
        const hasText = text !== undefined && text !== null;
        const hasNames = names !== undefined && names !== null;
        if (hasText === hasNames) throw new Error('text 与 names 须二选一');
        const list = hasText ? parseRoster(text) : normalizeNames(names);
        // 裁决（已接受）：解析结果为空时回 admin-error，不把空名单当作清空
        if (list.length === 0) throw new Error('名单为空');
        replaceRoster(list);
        return true;
      },
    },
    'teacher:clear-roster': {
      action: 'clear-roster',
      schema: shape({}),
      run() {
        clearRoster();
        return true;
      },
    },
    'teacher:reset-classroom': {
      action: 'reset-classroom',
      schema: shape({ confirm: 'boolean' }),
      run(socket, { confirm }) {
        if (confirm !== true) throw new Error('confirm must be true');
        resetClassroom();
        return true;
      },
    },
    'teacher:get-student-detail': {
      action: 'get-student-detail',
      schema: shape({ name: 'string:1-64' }),
      run(socket, { name }) {
        socket.emit('teacher:student-detail', {
          name,
          stageData: state.data.myStageData(name),
          events: db.loadStageEvents(name, state.classEpoch), // 裁决：只返回当前 epoch 的事件
        });
        return false; // 不回 admin-ok
      },
    },
    'teacher:release-binding': {
      action: 'release-binding',
      schema: shape({ name: 'string:1-64' }),
      run(socket, { name }) {
        releaseBinding(name.trim());
        return true;
      },
    },
  };

  async function handle(socket, event, payload) {
    const h = handlers[event];
    if (!h) return;
    const fail = (message) => socket.emit('teacher:admin-error', { action: h.action, message });
    if (socket.data?.role !== 'teacher') return fail('forbidden');
    try {
      const data = h.schema(payload);
      const ack = await h.run(socket, data);
      if (ack) socket.emit('teacher:admin-ok', { action: h.action });
    } catch (err) {
      const msg = err?.message ?? String(err);
      log.warn(`${event} failed: ${msg}`);
      fail(msg);
    }
  }

  function attach(socket) {
    for (const event of Object.keys(handlers)) {
      socket.on(event, (payload) => {
        handle(socket, event, payload).catch((err) => log.error(`${event} crashed`, err?.message));
      });
    }
  }

  // ===== HTTP =====
  const router = Router();

  router.get('/roster', (_req, res) => {
    res.json(rosterPayload());
  });

  router.get('/lan', requireTeacherToken(tokens), (_req, res) => {
    res.json({ addresses: lanAddresses() });
  });

  router.post('/admin/roster', requireLocalhost, (req, res) => {
    const names = Array.isArray(req.body?.names) ? req.body.names : null;
    if (!names) return res.status(400).json({ error: 'names must be an array' });
    const count = replaceRoster(normalizeNames(names));
    res.json({ ok: true, count });
  });

  router.post('/admin/roster/clear', requireLocalhost, (_req, res) => {
    clearRoster();
    res.json({ ok: true });
  });

  router.post('/admin/device-bindings/clear', requireLocalhost, (_req, res) => {
    clearBindings();
    res.json({ ok: true });
  });

  router.post('/admin/device-bindings/release', requireLocalhost, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    releaseBinding(name);
    res.json({ ok: true });
  });

  // 请求体与 socket 事件相同：{ confirm: true }，缺少或不为 true → 400
  router.post('/admin/reset', requireLocalhost, (req, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm must be true' });
    resetClassroom();
    res.json({ ok: true });
  });

  return { handle, attach, router, resetClassroom, replaceRoster, clearRoster, releaseBinding, clearBindings };
}
