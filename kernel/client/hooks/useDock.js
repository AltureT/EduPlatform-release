// useDock()（T9b，教师视图与学生页重排规格 §2.5）：学生端右侧停靠面板的开关。
//   → { open: 组件 id | null, openDock(id), closeDock() }
// 打开状态在 coreStudentStore.dock；学生外壳在内容区右列渲染该组件的 slots.studentDock（标题 dockTitle + ✕）。
// 窄屏（useNarrow）不用面板：open 恒为 null（store 里的状态不动，回到宽屏再出现），组件自己退回 Overlay drawer。
// 教师端（含镜像）没有面板：open 恒为 null，openDock / closeDock 不做事。
import { useCallback, useMemo } from 'react';
import { coreStudentStore } from '../stores/coreStudentStore.js';
import { useKernelRole } from './roleContext.js';
import { useNarrow } from '../layout/useNarrow.js';

const noop = () => {};

export function useDock() {
  const role = useKernelRole();
  const narrow = useNarrow();
  const dock = coreStudentStore((s) => s.dock);
  const student = role === 'student';
  const openDock = useCallback((id) => coreStudentStore.getState().openDock(id), []);
  const closeDock = useCallback(() => coreStudentStore.getState().closeDock(), []);
  return useMemo(() => ({
    open: student && !narrow ? dock ?? null : null,
    openDock: student ? openDock : noop,
    closeDock: student ? closeDock : noop,
  }), [student, narrow, dock, openDock, closeDock]);
}

export default useDock;
