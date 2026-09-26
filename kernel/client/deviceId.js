// 设备标识：localStorage 持久 UUID，服务端用它做"一台设备只绑定一个名字"的校验。
// 无 crypto.randomUUID 时回退为时间 + 随机拼接；localStorage 不可用时返回会话级 id（不持久）。

export const DEVICE_ID_KEY = 'classroom_device_id';

function generate() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const t = Date.now().toString(36);
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 10);
  return `dev-${t}-${r1}${r2}`;
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generate();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (_) {
    return generate();
  }
}

export function clearDeviceId() {
  try { localStorage.removeItem(DEVICE_ID_KEY); } catch (_) { /* 存储不可用 */ }
}
