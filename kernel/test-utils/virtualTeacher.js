// 冻结接口（规格 §10）：virtualTeacher(base, token) → Promise<{ socket, send, waitFor, advance({ force }) }>
// resolve 于 teacher:join-ok；advance → Promise<stage:change 载荷>，收到 teacher:advance-error 时 reject，5 s 超时
import { io } from 'socket.io-client';
import { waitFor } from './waitFor.js';

const JOIN_TIMEOUT = 5000;
const ADVANCE_TIMEOUT = 5000;

// 内部辅助（不经 index.js 公开）：在给定 socket 上发起一次推进，便于用假 socket 单测
export function advanceWith(socket, { force = false } = {}, timeout = ADVANCE_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`advance timeout (${timeout}ms)`));
    }, timeout);
    function onChange(data) {
      cleanup();
      resolve(data);
    }
    function onError(err) {
      cleanup();
      reject(new Error(`teacher:advance-error: ${err?.reason ?? err?.message ?? JSON.stringify(err)}`));
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off('stage:change', onChange);
      socket.off('teacher:advance-error', onError);
    }
    socket.on('stage:change', onChange);
    socket.on('teacher:advance-error', onError);
    socket.emit('teacher:advance', { force: !!force });
  });
}

export function virtualTeacher(base, token) {
  // K10：握手带 teacherToken，与教师端一致（连接时直接收教师版 classroom:state）
  const socket = io(base, { autoConnect: false, transports: ['websocket'], auth: { teacherToken: token } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.disconnect();
      reject(new Error(`virtualTeacher: join timeout (${JOIN_TIMEOUT}ms)`));
    }, JOIN_TIMEOUT);
    function onConnect() {
      socket.emit('teacher:join', { token });
    }
    function onOk() {
      cleanup();
      resolve({
        socket,
        send: (event, payload) => socket.emit(event, payload),
        waitFor: (event, timeout) => waitFor(socket, event, timeout),
        advance: (opts = {}) => advanceWith(socket, opts),
      });
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('teacher:join-ok', onOk);
    }
    socket.on('connect', onConnect);
    socket.on('teacher:join-ok', onOk);
    socket.connect();
  });
}
