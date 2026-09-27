// 把一切接起来（规格 §5、§6）
// createApp({ lessonPath, dbPath, componentsRoot?, vendorRoot?, distDir?, ai? }) → Promise<{ app, server, io, state, db, kernel, ai, start(port), stop() }>
//   K6：进程里只建一个 AI 实例（缺省 createAI() 读 process.env），经 createKernel 传给全部阶段与组件上下文
//   K2（v0.6）：组件 static 的相对目录以 vendorRoot ?? 项目根 解析；组件 http 路由挂在 /api/c/<id>/
// createKernel({ io, state, db, stages, registers, tokens, components?, ai? }) → socket 处理（可用 mockIo / mockSocket 单测）；ai 缺省未配置
// v0.5：组件在阶段之后加载与注册；组件钩子在 stage:change 广播后、classroom:reset 广播前依次调用
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { router as authRouter, tokens as authTokens } from './auth.js';
import { openDb } from './db.js';
import { createLog } from './log.js';
import { createState, PRELOGIN, CURTAIN } from './state.js';
import { hydrate, saveSnapshot, saveStudents } from './persistence.js';
import { loadLesson, loadStageServers } from './stage-loader.js';
import { createThrottle } from './throttle.js';
import { createStageContext, createDispatcher } from './stage-context.js';
import { createComponentContext, createComponentDispatcher, runComponentHooks } from './component-context.js';
import { loadComponents } from './component-loader.js';
import { staticDir } from './static-dir.js';
import { createExportRouter } from './export.js';
import { createAdmin } from './admin.js';
import { shape } from './schema.js';
import { createAI, unconfiguredAI } from './ai.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
// 规格 v0.5 §2.1：componentsRoot = <项目根>/components（与客户端 @components 别名同一目录）
export const DEFAULT_COMPONENTS_ROOT = path.join(PROJECT_ROOT, 'components');

const joinSchema = shape({ name: 'string:1-16', classEpoch: 'optional:string', deviceId: 'optional:string' });
const teacherJoinSchema = shape({ token: 'string' });
const advanceSchema = shape({ force: 'optional:boolean' });
const claimReleaseSchema = shape({ name: 'string:1-64' });
const switchNameSchema = shape({ rejoin: 'optional:boolean' });

const errMsg = (err) => (err && err.message ? err.message : String(err));

// 超时后不再等待（原 Promise 继续运行，结果忽略）
function withTimeout(fn, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    timer.unref?.();
  });
  const run = Promise.resolve().then(fn).then(() => ({ timedOut: false }));
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

export function createKernel({
  io, state, db, stages, registers, tokens, components = [], log = createLog('kernel'), onLeaveTimeoutMs = 2000, ai = unconfiguredAI(),
}) {
  const throttle = createThrottle({
    windowMs: 100,
    send: (payload) => io.to('teacher').emit('stage:data-update', payload),
  });

  const contexts = new Map();
  for (const s of stages) {
    contexts.set(s.id, createStageContext({ io, state, db, stageId: s.id, config: s.config, throttle, ai }));
  }
  // 注册期错误（非法事件名 / 保留名 / 重复）直接抛出，使启动失败
  for (const s of stages) {
    const register = registers?.get(s.id);
    if (register) register(contexts.get(s.id));
  }
  const dispatcher = createDispatcher({ io, state, contexts });

  // ===== 组件（v0.5）：阶段之后构造与注册；注册期错误同样使启动失败 =====
  const componentContexts = new Map();
  for (const c of components) {
    componentContexts.set(c.id, createComponentContext({
      id: c.id, options: c.options, io, state, db, throttle, stages, ai,
    }));
  }
  for (const c of components) {
    if (typeof c.register === 'function') c.register(componentContexts.get(c.id));
  }
  const componentDispatcher = createComponentDispatcher({ contexts: componentContexts });
  // 已加入的学生 socket：重置时清空其 socket.data（裁决：重新 join 前的阶段事件按 forbidden 拒绝）
  const studentSockets = new Set();
  const clearStudentSockets = () => {
    for (const s of studentSockets) s.data = {};
    studentSockets.clear();
  };
  // 重置：清学生 socket.data → 组件 onReset 钩子（admin 随后才广播 classroom:reset）
  const onReset = () => {
    clearStudentSockets();
    runComponentHooks(componentContexts, 'reset', undefined, log);
  };
  const admin = createAdmin({ io, state, db, throttle, tokens, onReset });

  const isHookStage = (id) => id !== PRELOGIN && id !== CURTAIN && state.isLessonStage(id);
  const rosterUpdate = () => io.emit('classroom:roster-update', state.students());

  // ===== teacher:advance（规格 §5.1）=====
  // 裁决（已接受）：非教师 / 载荷非法也回 teacher:advance-error { reason, soft:false }，不回 error:validation
  async function handleAdvance(socket, payload) {
    const fail = (reason, soft = false) => socket.emit('teacher:advance-error', { reason, soft });
    if (socket.data?.role !== 'teacher') return fail('forbidden');
    let force;
    try {
      ({ force } = advanceSchema(payload));
    } catch (err) {
      return fail(errMsg(err));
    }

    // 1
    if (state.currentStage === CURTAIN) return fail('已是最后阶段');
    if (state.advancing) return fail('正在推进');
    // 2
    state.advancing = true;
    const epoch = state.classEpoch;
    const fromId = state.currentStage;
    try {
      const cfg = isHookStage(fromId) ? state.stageConfig(fromId) : null;
      const ctx = contexts.get(fromId);
      // 3
      if (!force && cfg?.gate) {
        let result;
        try {
          result = await cfg.gate(ctx);
        } catch (err) {
          result = { ok: false, soft: false, reason: errMsg(err) };
        }
        if (!result || result.ok !== true) {
          fail(result?.reason ?? '', result?.soft === true);
          return;
        }
      }
      // 4
      if (cfg?.onLeave) {
        try {
          const r = await withTimeout(() => cfg.onLeave(ctx), onLeaveTimeoutMs);
          if (r.timedOut) log.warn(`onLeave of "${fromId}" timed out after ${onLeaveTimeoutMs}ms`);
        } catch (err) {
          log.error(`onLeave of "${fromId}" failed: ${errMsg(err)}`);
        }
      }
      // 裁决（已接受）：gate / onLeave 等待期间课堂被重置或已被推进 → 放弃本次推进并回 advance-error
      if (state.classEpoch !== epoch || state.currentStage !== fromId) {
        fail('课堂状态已变化');
        return;
      }
      // 5
      throttle.flushAll();
      const change = state.advance(Date.now());
      db.transaction(() => {
        saveSnapshot(state, db);
        saveStudents(state, db);
      });
      db.appendTeacherAction('advance', change.stage, { from: fromId, force: !!force }, state.classEpoch);
      // 6
      io.emit('stage:change', change);
      if (state.subPhase !== null) io.emit('stage:sub-phase', { stage: change.stage, subPhase: state.subPhase });
      rosterUpdate();
      runComponentHooks(componentContexts, 'stageChange', { from: fromId, to: change.stage }, log);
      // 7
      state.advancing = false;
      const next = isHookStage(change.stage) ? state.stageConfig(change.stage) : null;
      if (next?.onEnter) {
        const nctx = contexts.get(change.stage);
        Promise.resolve()
          .then(() => next.onEnter(nctx))
          .catch((err) => log.error(`onEnter of "${change.stage}" failed: ${errMsg(err)}`));
      }
    } finally {
      state.advancing = false;
    }
  }

  // ===== student:join（规格 §5.2 十步）=====
  // 裁决（已接受）：载荷非法回 student:join-error { message }（teacher:join 同理回 teacher:join-error）
  async function handleStudentJoin(socket, payload) {
    const fail = (message) => socket.emit('student:join-error', { message });
    let p;
    try {
      p = joinSchema(payload);
    } catch (err) {
      return fail(errMsg(err));
    }
    const { classEpoch, deviceId } = p;
    // 1
    if (classEpoch && classEpoch !== state.classEpoch) {
      socket.emit('classroom:reset', { reason: 'stale-session', message: '课堂已重置，请重新登录' });
      return;
    }
    const name = p.name.trim();
    if (!name) return fail('请输入姓名');
    // 2
    if (state.isRosterMode() && !state.rosterMap.has(name)) return fail(`名单里没有「${name}」`);
    // 3
    if (deviceId) {
      const boundName = state.getDeviceBinding(deviceId);
      // 带 boundName：客户端据此自动改以已绑定的名字进入，不让学生卡在登录页
      if (boundName && boundName !== name) return socket.emit('student:join-error', { message: `本设备已登录为「${boundName}」`, boundName });
      const owner = state.getDeviceByName(name);
      if (owner && owner !== deviceId) return fail(`「${name}」已被其他设备认领`);
    }
    // 4
    const result = state.addStudent(name, socket.id, deviceId || null);
    if (result.error) return fail(result.error);
    const finalName = result.student.name;
    // 5
    if (deviceId) {
      state.bindDevice(deviceId, finalName);
      db.upsertDeviceBinding(deviceId, finalName);
      io.emit('classroom:name-claim-update', { claimedNames: state.getClaimedNames() });
    }
    // 6
    socket.data = { role: 'student', name: finalName };
    studentSockets.add(socket);
    // 7
    const { firstEntry } = state.enterStudentIfNeeded(finalName);
    db.upsertStudent(state.studentRow(finalName));
    const s = state.getStudent(finalName);
    // 8
    socket.emit('student:join-ok', {
      student: { name: finalName, enteredStageAt: s.enteredStageAt, enteredStageIndex: s.enteredStageIndex },
      rejoin: !!result.rejoin,
      renamed: !!result.renamed,
      classEpoch: state.classEpoch,
      state: state.getPublicState(),
      myStageData: state.data.myStageData(finalName),
      classData: state.data.classData(),
    });
    // 9
    io.emit('student:joined', { name: finalName, counts: state.counts() });
    rosterUpdate();
    // 10
    const stageId = state.currentStage;
    const cfg = isHookStage(stageId) ? state.stageConfig(stageId) : null;
    if (cfg?.onLateJoin) {
      const copy = contexts.get(stageId).state.student(finalName);
      try {
        await cfg.onLateJoin(copy, contexts.get(stageId), { firstEntry });
      } catch (err) {
        log.error(`onLateJoin of "${stageId}" failed: ${errMsg(err)}`);
      }
    }
  }

  // ===== teacher:join =====
  async function handleTeacherJoin(socket, payload) {
    let token;
    try {
      ({ token } = teacherJoinSchema(payload));
    } catch (err) {
      return socket.emit('teacher:join-error', { message: errMsg(err) });
    }
    if (!tokens.has(token)) return socket.emit('teacher:join-error', { message: '登录已失效' });
    socket.data = { role: 'teacher', name: null };
    socket.join('teacher');
    socket.emit('teacher:join-ok', { state: state.getPublicState('teacher'), stageData: state.data.teacherStageData() });
  }

  // ===== student:request-claim-release（仅原主离线）=====
  async function handleRequestClaimRelease(socket, payload) {
    let name;
    try {
      name = claimReleaseSchema(payload).name.trim();
    } catch (err) {
      return socket.emit('student:request-claim-release-error', { message: errMsg(err) });
    }
    if (state.getStudent(name)?.connected) {
      return socket.emit('student:request-claim-release-error', { message: `「${name}」仍在线` });
    }
    if (state.getDeviceByName(name)) admin.releaseBinding(name);
    socket.emit('student:request-claim-release-ok', { name });
  }

  // ===== student:switch-name { rejoin? }（裁决定义；仅 prelogin）=====
  // 删除该生记录与设备绑定 → 广播 student:left、classroom:roster-update、classroom:name-claim-update →
  // 清空 socket.data → rejoin !== true 时单播 classroom:reset { reason:'switch-name' } → 回 student:switch-name-ok {}
  async function handleSwitchName(socket, payload) {
    const event = 'student:switch-name';
    const fail = (message) => socket.emit('error:validation', { event, message });
    let rejoin;
    try {
      ({ rejoin } = switchNameSchema(payload));
    } catch (err) {
      return fail(errMsg(err));
    }
    if (socket.data?.role !== 'student' || typeof socket.data.name !== 'string') return fail('forbidden');
    if (state.currentStage !== PRELOGIN) return fail('只能在课前换名');
    const name = socket.data.name;
    const s = state.getStudent(name);
    // 记录已被同名新连接接管（刷新竞态）时不删除他人的记录，只解除本 socket 身份
    if (s && s.socketId === socket.id) {
      state.removeStudent(name);
      db.deleteStudent(name);
      state.removeDeviceBindingByName(name);
      db.deleteDeviceBindingByName(name);
      io.emit('student:left', { name, counts: state.counts() });
      rosterUpdate();
      io.emit('classroom:name-claim-update', { claimedNames: state.getClaimedNames() });
    }
    socket.data = {};
    studentSockets.delete(socket);
    if (rejoin !== true) socket.emit('classroom:reset', { reason: 'switch-name' });
    socket.emit('student:switch-name-ok', {});
  }

  // ===== disconnect（刷新竞态：socketId 不一致则忽略）=====
  async function handleDisconnect(socket) {
    studentSockets.delete(socket);
    if (socket.data?.role !== 'student') return;
    const name = socket.data.name;
    const s = state.getStudent(name);
    if (!s || s.socketId !== socket.id) return;
    state.markDisconnected(name);
    db.upsertStudent(state.studentRow(name));
    io.emit('student:left', { name, counts: state.counts() });
    rosterUpdate();
  }

  // safeOn：处理函数异常转成 error:validation
  function safeOn(socket, event, handler) {
    socket.on(event, async (...args) => {
      try {
        await handler(socket, ...args);
      } catch (err) {
        const message = errMsg(err);
        log.warn(`[socket:${event}] ${message}`);
        try {
          socket.emit('error:validation', { event, message });
        } catch {
          // socket 已断开
        }
      }
    });
  }

  function onConnection(socket) {
    socket.data = socket.data || {};
    socket.emit('classroom:state', state.getPublicState());
    safeOn(socket, 'student:join', handleStudentJoin);
    safeOn(socket, 'teacher:join', handleTeacherJoin);
    safeOn(socket, 'teacher:advance', handleAdvance);
    safeOn(socket, 'student:request-claim-release', handleRequestClaimRelease);
    safeOn(socket, 'student:switch-name', handleSwitchName);
    admin.attach(socket);
    dispatcher.attach(socket);
    componentDispatcher.attach(socket);
    socket.on('disconnect', () => {
      handleDisconnect(socket).catch((err) => log.error(`disconnect failed: ${errMsg(err)}`));
    });
  }

  return {
    ai,
    throttle,
    contexts,
    dispatcher,
    componentContexts,
    componentDispatcher,
    admin,
    onConnection,
    handleAdvance,
    handleStudentJoin,
    handleTeacherJoin,
    handleRequestClaimRelease,
    handleSwitchName,
    handleDisconnect,
  };
}

export async function createApp({
  lessonPath, dbPath, tokens = authTokens, componentsRoot = DEFAULT_COMPONENTS_ROOT, vendorRoot, distDir = DIST_DIR, ai = createAI(),
}) {
  const log = createLog('server');
  const { lessonConfig, stages } = await loadLesson(lessonPath);
  const registers = await loadStageServers(stages);
  const components = await loadComponents(lessonConfig, componentsRoot);
  const db = openDb(dbPath);
  const state = createState({ lesson: lessonConfig, stages, components });

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const server = http.createServer(app);
  const io = new Server(server);

  let kernel;
  // K2（v0.6）：组件 HTTP 路由；http(router, cctx) 在 createKernel 之后调用，抛错与 createKernel 失败同样处理
  const componentRouters = [];
  try {
    hydrate(state, db);
    kernel = createKernel({ io, state, db, stages, registers, tokens, components, ai });
    for (const c of components) {
      if (typeof c.http !== 'function') continue;
      const router = express.Router();
      c.http(router, kernel.componentContexts.get(c.id));
      componentRouters.push([c.id, router]);
    }
  } catch (err) {
    db.close();
    io.close();
    throw err;
  }

  app.use('/api', authRouter);
  app.use('/api', kernel.admin.router);
  app.use('/api', createExportRouter({ state, tokens }));
  for (const [id, router] of componentRouters) app.use(`/api/c/${id}`, router);
  // K2（v0.6）：组件声明的静态目录，挂在 SPA 回退之前（缺文件 404，不回 index.html）；目录缺失只 warn，不拒绝启动
  for (const c of components) {
    for (const [prefix, dir] of Object.entries(c.static ?? {})) {
      const abs = path.resolve(vendorRoot ?? PROJECT_ROOT, dir);
      if (!fs.existsSync(abs)) log.warn(`component "${c.id}": static dir for ${prefix} not found (${abs}); all requests will 404`);
      app.use(prefix, staticDir(abs));
    }
  }
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      // 用 root：express 5 的 sendFile 对含点目录（如 .claude/worktrees）的绝对路径返回 404
      res.sendFile('index.html', { root: distDir });
    });
  }
  io.on('connection', (socket) => kernel.onConnection(socket));

  let stopped = false;
  return {
    app,
    server,
    io,
    state,
    db,
    kernel,
    ai,
    start(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          server.off('error', reject);
          const actual = server.address().port;
          log.info(`listening on ${actual}`);
          resolve(actual);
        });
      });
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      kernel.throttle.flushAll();
      await new Promise((resolve) => {
        io.close(() => resolve());
        server.closeAllConnections?.();
      });
      db.close();
    },
  };
}
