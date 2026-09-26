// Page.Actions → 外壳操作条（界面整理规格 §2.2、§3.5）。
// 外壳为每个内容区创建一个 sink 并经 ActionSinkContext 提供；<Page> 在布局阶段把 Actions 的内容登记进 sink，
// 外壳的操作条订阅 sink 并在网格最后一行渲染（不是 portal）。只有操作条订阅，登记不会让阶段视图重渲染。
import { createContext, useLayoutEffect, useRef } from 'react';

export const ActionSinkContext = createContext(null);

let seq = 0;

export function createActionSink() {
  const entries = new Map();
  const subs = new Set();
  let version = 0;
  const emit = () => {
    version += 1;
    for (const fn of subs) fn();
  };
  return {
    set(id, node) {
      if (node == null || node === false) {
        if (entries.delete(id)) emit();
        return;
      }
      entries.set(id, node);
      emit();
    },
    remove(id) {
      if (entries.delete(id)) emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    getVersion() {
      return version;
    },
    nodes() {
      return [...entries.entries()];
    },
  };
}

// 每次渲染把 node 写入 sink；卸载或 sink 变化时移除
export function useActionSink(sink, node) {
  const idRef = useRef(null);
  if (idRef.current == null) {
    seq += 1;
    idRef.current = `page-actions-${seq}`;
  }
  useLayoutEffect(() => {
    if (sink) sink.set(idRef.current, node);
  });
  useLayoutEffect(() => {
    if (!sink) return undefined;
    const id = idRef.current;
    return () => sink.remove(id);
  }, [sink]);
}
