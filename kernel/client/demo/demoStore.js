// 教师演示模式的本地记录（T9a，教师视图与学生页重排规格 §2.2；沿用 P7 LiveDemo 的内存做法）
// - 只在内存里（不发事件、不写草稿、不进 localStorage）：键 `${classEpoch}:${stageId}` → 演示记录（对象）
//   教师 store 不存 classEpoch，教师端键的前半段恒为空串；课堂重置靠 classroom:reset 时 resetDemoRecords()（coreTeacherStore 调）
// - 换段保留（教师切到别的段再回来，演示时点过 / 写过的还在）；刷新页面清空
// - setDemoRecord(key, patch)：patch 为对象时浅合并进原记录；为函数时 (prev) => 新记录（整条替换）；为 null 时删掉这条
import { create } from 'zustand';

export const useDemoRecords = create(() => ({ records: {} }));

export const demoKey = (classEpoch, stageId) => `${classEpoch ?? ''}:${stageId ?? ''}`;

export function setDemoRecord(key, patch) {
  useDemoRecords.setState((s) => {
    const prev = s.records[key];
    let next;
    if (patch === null) next = undefined;
    else if (typeof patch === 'function') next = patch(prev);
    else if (patch && typeof patch === 'object') next = { ...(prev && typeof prev === 'object' ? prev : {}), ...patch };
    else return s;
    const records = { ...s.records };
    if (next === undefined) delete records[key];
    else records[key] = next;
    return { records };
  });
}

export function resetDemoRecords() {
  useDemoRecords.setState({ records: {} });
}
