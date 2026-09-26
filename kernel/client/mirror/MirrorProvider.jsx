// <MirrorProvider name record classData me>…</MirrorProvider>（规格 v0.5 §2.4，公开导出）
// 内部的 useStudentStage(id) 改读 record / classData / me，send 为 no-op，readOnly: true。
// name 仅作展示用标识（真名或匿名代号，与 me.name 一致），内核不用它取数据。
// 只读锁：外层 overflow:auto 可滚动，内层 inert；阶段无需适配。
import { useMemo } from 'react';
import { MirrorContext } from './mirrorContext.js';

export default function MirrorProvider({ name, record, classData, me, children }) {
  const value = useMemo(() => ({ name, record, classData, me }), [name, record, classData, me]);
  return (
    <MirrorContext.Provider value={value}>
      <div style={{ overflow: 'auto' }}>
        <div inert>{children}</div>
      </div>
    </MirrorContext.Provider>
  );
}
