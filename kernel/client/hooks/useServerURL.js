import { useCallback, useEffect, useState } from 'react';

// 当前页面的站点根地址（协议 + 主机 + 非默认端口），用于二维码与地址展示
export function serverURLFromLocation(loc) {
  const { hostname, port, protocol } = loc;
  return port && port !== '80' && port !== '443'
    ? `${protocol}//${hostname}:${port}`
    : `${protocol}//${hostname}`;
}

export function useServerURL() {
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl(serverURLFromLocation(window.location));
  }, []);
  return url;
}

// v0.7（界面整理规格 §4；U1 审查）：教师课前页二维码地址。
// - 页面经局域网地址 / 域名打开（hostname 不是 localhost、127.x、::1）时，学生用同一个地址即可：直接用 location.origin，不请求
// - 经本机打开时请求 GET /api/lan → { addresses: [] }（服务端已过滤、排序），每个地址配上当前协议与端口作为候选；
//   缺省取第一个，候选多于一个时由页面列出让教师点选（pick）；无候选或请求失败时回退 location.origin
// - U4：请求带教师 token（{ token }），端点无 token 回 401
export function shouldQueryLan(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
}

export function lanURLFrom(address, loc) {
  const { protocol, port } = loc;
  return port && port !== '80' && port !== '443'
    ? `${protocol}//${address}:${port}`
    : `${protocol}//${address}`;
}

const NO_CANDIDATES = [];

// U4：/api/lan 要求教师 token（Authorization: Bearer）；没有 token 时不请求，401 或失败时回退 location.origin
export function useLanURL({ loc = typeof window !== 'undefined' ? window.location : null, token = null } = {}) {
  const [state, setState] = useState({ url: '', candidates: NO_CANDIDATES });
  const hostname = loc ? loc.hostname : '';
  useEffect(() => {
    if (!loc) return undefined;
    let alive = true;
    const fallback = serverURLFromLocation(loc);
    setState({ url: fallback, candidates: NO_CANDIDATES });
    if (!shouldQueryLan(loc.hostname) || !token) return undefined;
    (async () => {
      try {
        if (typeof fetch !== 'function') return;
        const res = await fetch('/api/lan', { headers: { Authorization: `Bearer ${token}` } });
        if (!res || !res.ok) return;
        const body = await res.json();
        const list = Array.isArray(body && body.addresses)
          ? body.addresses.filter((a) => typeof a === 'string' && a).map((a) => lanURLFrom(a, loc))
          : [];
        if (alive && list.length) setState({ url: list[0], candidates: list });
      } catch (_) {
        // 回退已设置
      }
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostname, token]);
  const pick = useCallback((url) => setState((s) => (s.candidates.includes(url) ? { ...s, url } : s)), []);
  return { url: state.url, candidates: state.candidates, pick };
}

export default useServerURL;
