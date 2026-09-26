// 按 key 节流（规格 §6）：首次立即发；窗口内的后续更新合并，窗口结束时只发最后一个；
// 窗口末发送后开启新窗口，窗口内无更新则结束。flushAll() 立即发出全部待发；dropAll() 丢弃全部待发
export function createThrottle({ windowMs = 100, send }) {
  // key → { timer, pending: { payload } | null }
  const entries = new Map();

  function openWindow(key) {
    const entry = { timer: null, pending: null };
    entry.timer = setTimeout(() => onWindowEnd(key), windowMs);
    entry.timer.unref?.();
    entries.set(key, entry);
  }

  function onWindowEnd(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    if (entry.pending) {
      send(entry.pending.payload, key);
      openWindow(key);
    }
  }

  return {
    push(key, payload) {
      const entry = entries.get(key);
      if (entry) {
        entry.pending = { payload };
        return;
      }
      send(payload, key);
      openWindow(key);
    },
    flushAll() {
      const list = Array.from(entries.entries());
      entries.clear();
      for (const [key, entry] of list) {
        clearTimeout(entry.timer);
        if (entry.pending) send(entry.pending.payload, key);
      }
    },
    dropAll() {
      for (const entry of entries.values()) clearTimeout(entry.timer);
      entries.clear();
    },
  };
}
