// 断点（界面整理规格 §2.1）：narrow < 900 px，wide ≥ 900 px。
// jsdom 等没有 matchMedia 的环境一律视为 wide（返回 false）。
import { useEffect, useState } from 'react';

export const NARROW_QUERY = '(max-width: 899px)';

function mediaList(query) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(query);
  } catch (_) {
    return null;
  }
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => !!mediaList(query)?.matches);
  useEffect(() => {
    const mql = mediaList(query);
    if (!mql) {
      setMatches(false);
      return undefined;
    }
    setMatches(!!mql.matches);
    const onChange = (e) => setMatches(!!e.matches);
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onChange);
    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
      else if (typeof mql.removeListener === 'function') mql.removeListener(onChange);
    };
  }, [query]);
  return matches;
}

export function useNarrow() {
  return useMediaQuery(NARROW_QUERY);
}

export default useNarrow;
