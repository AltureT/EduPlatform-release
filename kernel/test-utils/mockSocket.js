// 冻结接口（规格 §10）：mockSocket(role, name) → { id, data:{role,name}, emit, emitted:[{event,payload}], join, rooms }
let seq = 0;

export function mockSocket(role, name) {
  const id = `mock-socket-${++seq}`;
  const emitted = [];
  // 与 socket.io 一致：socket 默认在以自身 id 命名的房间里
  const rooms = new Set([id]);
  return {
    id,
    data: { role, name },
    emitted,
    rooms,
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    join(room) {
      for (const r of Array.isArray(room) ? room : [room]) rooms.add(r);
    },
  };
}
