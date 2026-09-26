// 列排序状态 + 排序应用器
// useColumnSort(defaultKey, defaultDir) → { key, dir, toggle(k) }：同列再点切换方向，换列默认 desc
// applySort(rows, accessors, key, dir, locale='zh')：返回副本；空值（null/undefined/NaN）一律沉底
import { useCallback, useState } from 'react';

export function useColumnSort(defaultKey, defaultDir = 'desc') {
  const [state, setState] = useState({ key: defaultKey, dir: defaultDir });
  const toggle = useCallback((k) => {
    setState((cur) => {
      if (cur.key === k) return { key: k, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return { key: k, dir: 'desc' };
    });
  }, []);
  return { key: state.key, dir: state.dir, toggle };
}

export function applySort(rows, accessors, key, dir, locale = 'zh') {
  if (!Array.isArray(rows) || !key || !accessors || !accessors[key]) return rows;
  const accessor = accessors[key];
  const sign = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = accessor(a);
    const vb = accessor(b);
    const aNull = va == null || (typeof va === 'number' && Number.isNaN(va));
    const bNull = vb == null || (typeof vb === 'number' && Number.isNaN(vb));
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof va === 'string' && typeof vb === 'string') {
      return va.localeCompare(vb, locale) * sign;
    }
    if (va > vb) return 1 * sign;
    if (va < vb) return -1 * sign;
    return 0;
  });
}
