// 渲染通过 registerKernelHook('curtainSlot', Component) 注册的组件；默认为空
// @deprecated v0.5：组件请改用 client.jsx 的 slots.teacherCurtain / studentCurtain（规格 §2.3）；此入口保留以兼容
import { useSyncExternalStore } from 'react';
import { getKernelHooks, getKernelHooksVersion, subscribeKernelHooks } from '../stores/kernelHooks.js';

export default function CurtainSlot({ role }) {
  useSyncExternalStore(subscribeKernelHooks, getKernelHooksVersion, getKernelHooksVersion);
  const comps = getKernelHooks('curtainSlot');
  if (comps.length === 0) return null;
  return (
    <>
      {comps.map((Comp, i) => <Comp key={Comp.displayName || Comp.name || i} role={role} />)}
    </>
  );
}
