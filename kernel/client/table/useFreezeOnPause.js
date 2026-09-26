// 暂停时把 liveValue 冻结成快照；暂停期间 live 变化只累加 pendingCount，恢复时立即吐回 live 值
// 用法：const [value, pending] = useFreezeOnPause(liveValue, paused)
import { useEffect, useRef, useState } from 'react';

export function useFreezeOnPause(liveValue, paused) {
  const [snapshot, setSnapshot] = useState(liveValue);
  const [pendingCount, setPendingCount] = useState(0);
  const wasPausedRef = useRef(null);

  useEffect(() => {
    if (wasPausedRef.current === null) {
      if (paused) setSnapshot(liveValue);
      wasPausedRef.current = paused;
      return;
    }
    if (paused && !wasPausedRef.current) {
      setSnapshot(liveValue);
      setPendingCount(0);
    } else if (!paused && wasPausedRef.current) {
      setPendingCount(0);
    } else if (paused) {
      setPendingCount((c) => c + 1);
    }
    wasPausedRef.current = paused;
  }, [paused, liveValue]);

  return [paused ? snapshot : liveValue, pendingCount];
}
