// 冻结接口（规格 §10）：mockIo() → { to(room), except(room), emit, emitted: [{ room: string|null, event, payload, except?: true }] }
// except(room).emit 的记录多一个 except: true，用于区分“发给房间”与“发给房间以外”
export function mockIo() {
  const emitted = [];
  const roomEmitter = (room, except) => ({
    emit(event, payload) {
      emitted.push(except ? { room: String(room), event, payload, except: true } : { room: String(room), event, payload });
    },
  });
  return {
    emitted,
    to: (room) => roomEmitter(room, false),
    except: (room) => roomEmitter(room, true),
    emit(event, payload) {
      emitted.push({ room: null, event, payload });
    },
  };
}
