// 内核钩子注册表（规格 §9.1 / §9.2）：
// - 'stageChange'：收到 stage:change 后调用 fn(payload)
// - 'reset'：收到 classroom:reset 后调用 fn(payload)
// - 'curtainSlot'：注册一个 React 组件，渲染在谢幕页 <CurtainSlot /> 位置
//   @deprecated v0.5：组件改用 client.jsx 的 slots.teacherCurtain / studentCurtain（规格 §2.3），此钩子保留以兼容
// registerKernelHook 返回注销函数。

export const KERNEL_HOOK_NAMES = ['stageChange', 'reset', 'curtainSlot'];

const registry = new Map(KERNEL_HOOK_NAMES.map((n) => [n, new Set()]));
const subscribers = new Set();

export function registerKernelHook(name, fn) {
  if (!registry.has(name)) throw new Error(`registerKernelHook: unknown hook "${name}"`);
  if (typeof fn !== 'function') throw new Error(`registerKernelHook: "${name}" expects a function`);
  registry.get(name).add(fn);
  notify();
  return () => {
    if (registry.get(name).delete(fn)) notify();
  };
}

export function getKernelHooks(name) {
  return registry.has(name) ? [...registry.get(name)] : [];
}

export function runKernelHooks(name, payload) {
  for (const fn of getKernelHooks(name)) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[kernelHook:${name}]`, err);
    }
  }
}

// 供 CurtainSlot 订阅注册变化
export function subscribeKernelHooks(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

let version = 0;
export function getKernelHooksVersion() {
  return version;
}

function notify() {
  version += 1;
  for (const cb of subscribers) cb();
}
