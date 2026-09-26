// 冻结接口（规格 §10）：virtualStudent(base, name, opts?) → Promise<{ socket, name, send(event, payload), waitFor(event, timeout) }>
// opts = { deviceId }（可选，向后兼容扩展）：缺省自动生成 deviceId；resolve 于 student:join-ok，reject 于 student:join-error
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { waitFor } from './waitFor.js';

const JOIN_TIMEOUT = 5000;

export function virtualStudent(base, name, opts = {}) {
  const socket = io(base, { autoConnect: false, transports: ['websocket'] });
  const deviceId = opts.deviceId ?? randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.disconnect();
      reject(new Error(`virtualStudent: join timeout (${JOIN_TIMEOUT}ms): ${name}`));
    }, JOIN_TIMEOUT);
    function onConnect() {
      socket.emit('student:join', { name, deviceId });
    }
    function onOk() {
      cleanup();
      resolve({
        socket,
        name,
        send: (event, payload) => socket.emit(event, payload),
        waitFor: (event, timeout) => waitFor(socket, event, timeout),
      });
    }
    function onError(err) {
      cleanup();
      socket.disconnect();
      reject(new Error(`virtualStudent: student:join-error: ${err?.message ?? JSON.stringify(err)}`));
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('student:join-ok', onOk);
      socket.off('student:join-error', onError);
    }
    socket.on('connect', onConnect);
    socket.on('student:join-ok', onOk);
    socket.on('student:join-error', onError);
    socket.connect();
  });
}
