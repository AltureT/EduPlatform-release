// 组件槽位（规格 v0.5 §2.3）：外壳内部件，不公开。
// 按 classroom:state.components 顺序渲染每个已打开组件的同名槽位；同槽位多个组件依次渲染；
// 没有任何组件提供该槽位时不产生 DOM（未开组件时外壳 DOM 与 v0.4.1 一致）。
// 每个槽位包一层错误边界：组件渲染抛错只记日志、该槽位渲染为空，不拖垮外壳。
import { Component, useMemo } from 'react';
import { coreStudentStore } from '../stores/coreStudentStore.js';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import { assembleComponents, SLOT_NAMES } from '../stores/componentRegistry.js';
import { useKernelRole } from '../hooks/roleContext.js';

export { SLOT_NAMES };

class SlotBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.error(`[component:${this.props.id}] 槽位 ${this.props.slot} 渲染出错`, err);
  }
  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}

export function useOpenComponents(role) {
  const studentList = coreStudentStore((s) => s.components);
  const teacherList = coreTeacherStore((s) => s.components);
  const list = role === 'teacher' ? teacherList : studentList;
  return useMemo(() => assembleComponents(list), [list]);
}

// 学生横幅区的组件行（界面整理规格 v0.2.2 §2.2）：每个提供者包一层 <div data-banner-row={id} class="banner-row">
// （行间底线；提供者返回 null 时 :empty 隐藏，不占位）；无提供者时返回 null，外壳据此不渲染横幅区
export function useStudentBanner() {
  const components = useOpenComponents('student');
  const list = slotProviders(components, 'studentBanner');
  if (list.length === 0) return null;
  return list.map((c) => {
    const Banner = c.slots.studentBanner;
    return (
      <div key={`banner-${c.id}`} data-banner-row={c.id} className="banner-row">
        <SlotBoundary id={c.id} slot="studentBanner">
          <Banner />
        </SlotBoundary>
      </div>
    );
  });
}

// C5（课程本地组件规格 §3）：学生页段内旁挂 studentAside——<Page> 在学生视图（含镜像）里调用，
// 每个提供者一行 <div data-aside-row={id} class="aside-row">（提供者返回 null 时 :empty 隐藏，不占位），
// 按 lesson.config 顺序纵向堆叠；props { stageId, isLive }；无提供者时返回 null（不产生任何包裹元素）。
// 组件列表取本端 core store（学生外壳 = 学生端；教师端镜像 = 教师端，组件列表相同）
export function StudentAside({ stageId, isLive }) {
  const components = useOpenComponents(useKernelRole());
  const list = slotProviders(components, 'studentAside');
  if (list.length === 0) return null;
  return list.map((c) => {
    const Aside = c.slots.studentAside;
    return (
      <div key={`aside-${c.id}`} data-aside-row={c.id} className="aside-row">
        <SlotBoundary id={c.id} slot="studentAside">
          <Aside stageId={stageId} isLive={isLive} />
        </SlotBoundary>
      </div>
    );
  });
}

export function slotProviders(components, slot) {
  return components.filter((c) => typeof c.slots[slot] === 'function');
}

// <ComponentSlot role slot props />：依次渲染；无提供者时返回 null
export function ComponentSlot({ role, slot, props = {} }) {
  const components = useOpenComponents(role);
  const list = slotProviders(components, slot);
  if (list.length === 0) return null;
  return list.map((c) => {
    const Slot = c.slots[slot];
    return (
      <SlotBoundary key={c.id} id={c.id} slot={slot}>
        <Slot {...props} />
      </SlotBoundary>
    );
  });
}

// teacherMain：多组件按顺序嵌套（第一个组件在最外层）；无提供者时原样返回 children
export function wrapTeacherMain(components, children, props) {
  const list = slotProviders(components, 'teacherMain');
  let out = children;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const c = list[i];
    const Main = c.slots.teacherMain;
    out = (
      <SlotBoundary key={c.id} id={c.id} slot="teacherMain" fallback={out}>
        <Main {...props}>{out}</Main>
      </SlotBoundary>
    );
  }
  return out;
}
