// FLIP 动画：keys 顺序变化时，按前后位置差让行平滑过渡
// itemRefs.current[key] 指向行元素
import { useLayoutEffect, useRef } from 'react';

export function useFlipPositions(keys, itemRefs, enabled = true) {
  const prevRectsRef = useRef(new Map());
  const sig = keys.join('|');
  useLayoutEffect(() => {
    if (!enabled) {
      prevRectsRef.current = new Map();
      return;
    }
    const prevRects = prevRectsRef.current;
    const nextRects = new Map();
    keys.forEach((key) => {
      const el = itemRefs.current[key];
      if (el) nextRects.set(key, el.getBoundingClientRect());
    });
    keys.forEach((key) => {
      const el = itemRefs.current[key];
      if (!el) return;
      const before = prevRects.get(key);
      const after = nextRects.get(key);
      if (!before || !after) return;
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // 强制回流后再动画回原位
      void el.offsetWidth;
      el.style.transition = 'transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)';
      el.style.transform = 'translate(0, 0)';
    });
    prevRectsRef.current = nextRects;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, enabled]);
}
