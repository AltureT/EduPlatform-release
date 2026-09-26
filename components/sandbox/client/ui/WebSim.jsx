// <WebSim stageId home>（规格 §3.5）：模拟浏览器
// 布局（界面整理规格 §3）：外层 <Fill> 撑满父级（不再有 height）；地址栏行高 --control-h；页面区占满剩余高度
// 顶部 [◀] [▶] [↻] [ /path ] [前往] + 状态码芯片；主体 iframe sandbox="allow-scripts allow-forms allow-modals"（无 allow-same-origin）
// 导航 = pythonClient.http()：HTML → 内联子资源后注入 srcdoc；JSON → 美化 <pre>；文本 → <pre>；图片 → <img>；其他二进制 → "二进制 N 字节"
// 父页面只认 event.source === iframe.contentWindow 且形状合法的消息；永远不对 iframe 发来的路径做真实 fetch
// S3：iframe 第二次 load 起视为页面已跳走（外链导航）：丢弃回应、忽略其消息、提示不能访问外网，↻ 重载恢复
// 组件内把自己的 http() 串行排队（页面并发的 fetch 不会因 busy 被拒）；学生成功运行后自动 GET 刷新当前页
// S3：onResponse({ status, path, method, finalPath })：每次导航（挂载、地址栏、◀ ▶ ↻、自动刷新、iframe 里的链接 / 表单）结束后回调；
//   path 为请求路径、finalPath 为跟随重定向后的路径；no-app 时 status 502，其他失败（超时、被停止…）为 null；
//   被后一次导航取代的请求不回调；iframe 页面自己的 fetch / XHR 不算导航
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudentStage, Btn, Chip, Fill } from '#kernel/client/index.js';
import { getPythonClient } from '../pythonClient.js';
import { MONO } from './mono.js';
import { prepareHtml, inlineSubresources, handleMessage, externalLocation, headerOf } from './websimBridge.js';

const NO_NET = '模拟浏览器不能访问外网';
const NO_APP = '502 · 还没有定义 app，请先运行';
const NAV_AWAY = `${NO_NET}（页面已跳走，点 ↻ 重新载入）`;

export function kindOf(res) {
  const mime = String(res?.contentType || headerOf(res?.headers, 'content-type') || '').split(';')[0].trim().toLowerCase();
  if (res?.binary) return mime.startsWith('image/') ? 'image' : 'binary';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime === 'application/json' || mime.endsWith('+json')) return 'json';
  return 'text';
}

function base64Bytes(b64) {
  const s = String(b64 ?? '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

function pretty(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return String(text ?? '');
  }
}

function errorText(e) {
  const m = String(e?.message ?? e);
  if (m === 'busy') return '代码正在运行，稍后再试';
  if (m === 'timeout') return '请求超时';
  if (m === 'interrupted' || m === 'restarted') return '运行环境已重启，请重新运行定义 app 的代码';
  if (m === 'failed') return '运行环境没有加载成功';
  return m;
}

const toneOf = (status) => {
  if (!Number.isFinite(status)) return 'neutral';
  if (status >= 400) return 'bad';
  if (status >= 300) return 'accent';
  return 'good';
};

const pre = {
  margin: 0,
  padding: 12,
  fontFamily: MONO,
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
  color: 'var(--ink)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

function Chrome({ addr, setAddr, invalid, onSubmit, canBack, canFwd, onBack, onFwd, onReload, status, disabled }) {
  const tone = toneOf(status);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 6,
        background: 'var(--surface-alt)',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      <Btn variant="ghost" aria-label="后退" disabled={disabled || !canBack} onClick={onBack}>◀</Btn>
      <Btn variant="ghost" aria-label="前进" disabled={disabled || !canFwd} onClick={onFwd}>▶</Btn>
      <Btn variant="ghost" aria-label="刷新" disabled={disabled} onClick={onReload}>↻</Btn>
      <input
        aria-label="地址"
        aria-invalid={invalid ? 'true' : 'false'}
        value={addr}
        disabled={disabled}
        onChange={(e) => setAddr?.(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 120,
          height: 'var(--control-h)',
          padding: '0 8px',
          fontFamily: MONO,
          fontSize: '16px',
          color: 'var(--ink)',
          background: 'var(--surface)',
          border: `1px solid ${invalid ? 'var(--bad)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-sm)',
          boxSizing: 'border-box',
        }}
      />
      <Btn variant="ghost" type="submit" disabled={disabled}>前往</Btn>
      <span data-websim-status="" data-tone={tone}>
        <Chip tone={tone}>{Number.isFinite(status) ? String(status) : '—'}</Chip>
      </span>
    </form>
  );
}

const frameStyle = {
  flex: '1 1 0%',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  minWidth: 0,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface)',
  overflow: 'hidden',
};

const fillView = { flex: '1 1 0%', minHeight: 0, overflow: 'auto' };

function Body({ view, iframeRef, onFrameLoad }) {
  if (!view) return null;
  if (view.kind === 'html') {
    return (
      <iframe
        key={view.seq}
        ref={iframeRef}
        title="模拟浏览器"
        sandbox="allow-scripts allow-forms allow-modals"
        srcDoc={view.html}
        onLoad={() => onFrameLoad?.(view.seq)}
        style={{ flex: '1 1 0%', minHeight: 0, width: '100%', border: 'none', background: 'var(--surface)' }}
      />
    );
  }
  if (view.kind === 'image') {
    return <div style={{ ...fillView, padding: 12 }}><img alt="" src={view.src} style={{ maxWidth: '100%', height: 'auto' }} /></div>;
  }
  if (view.kind === 'binary') return <div style={{ ...fillView, ...pre, color: 'var(--ink-soft)' }}>{`二进制 ${view.bytes} 字节`}</div>;
  return <div style={fillView}><pre style={pre}>{view.text}</pre></div>;
}

function LiveWebSim({ home, onResponse }) {
  const client = getPythonClient();
  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;
  const iframeRef = useRef(null);
  const [addr, setAddr] = useState(home);
  const [invalid, setInvalid] = useState(false);
  const [hist, setHist] = useState({ list: [], idx: -1 });
  const [view, setView] = useState(null);
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState(null);
  const histRef = useRef(hist);
  // S3：iframe 的 load 计数（每个 view.seq 一个 iframe）。srcdoc 载入是第一次；第二次起说明页面自己跳走了
  // （location.href = 'https://…'，CSP 拦不住导航），此后 contentWindow 仍是同一个 WindowProxy：丢弃回应、忽略其消息
  const frame = useRef({ seq: null, loads: 0, away: false });
  const viewSeq = useRef(null);
  viewSeq.current = view?.kind === 'html' ? view.seq : null;
  const frameAway = () => frame.current.away && frame.current.seq === viewSeq.current;
  const onFrameLoad = useCallback((seq) => {
    if (frame.current.seq !== seq) frame.current = { seq, loads: 0, away: false };
    const st = frame.current;
    st.loads += 1;
    if (st.loads >= 2 && !st.away) {
      st.away = true;
      if (mounted.current) setNotice(NAV_AWAY);
    }
  }, []);
  histRef.current = hist;
  const lastReq = useRef(null);
  const navSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 本组件的 http() 串行
  const chain = useRef(Promise.resolve());
  const http = useCallback((method, path, opts = {}) => {
    const p = chain.current.then(() => client.http(method, path, opts));
    chain.current = p.then(() => {}, () => {});
    return p;
  }, [client]);

  // mode：'push' 新条目；'at' 跳到历史里的 idx；'none' 不动历史（↻）
  const go = useCallback(async (req, mode = 'push', idx = null) => {
    const seq = ++navSeq.current;
    lastReq.current = req;
    setNotice(null);
    setInvalid(false);
    let res = null;
    let err = null;
    try {
      res = await http(req.method, req.path, { body: req.body ?? null, headers: req.headers ?? {} });
    } catch (e) {
      err = e;
    }
    if (!mounted.current || seq !== navSeq.current) return;
    const finalPath = res?.finalPath || req.path;
    const noApp = !!err && String(err?.message) === 'no-app';
    const respStatus = err ? (noApp ? 502 : null) : Number(res.status);
    try {
      onResponseRef.current?.({ status: Number.isFinite(respStatus) ? respStatus : null, path: req.path, method: req.method, finalPath });
    } catch (e) {
      console.warn('[sandbox] onResponse 出错', e);
    }
    setAddr(finalPath);
    setHist((h) => {
      if (mode === 'none') return h;
      if (mode === 'at') {
        const list = h.list.slice();
        list[idx] = finalPath;
        return { list, idx };
      }
      const list = h.list.slice(0, h.idx + 1);
      if (!(req.method === 'GET' && list[list.length - 1] === finalPath)) list.push(finalPath);
      return { list, idx: list.length - 1 };
    });
    if (err) {
      if (String(err?.message) === 'no-app') {
        setStatus(502);
        setView({ kind: 'text', text: NO_APP });
      } else {
        setStatus(null);
        setView({ kind: 'text', text: errorText(err) });
      }
      return;
    }
    setStatus(Number(res.status));
    if (externalLocation(res)) setNotice(NO_NET);
    const kind = kindOf(res);
    if (kind === 'html') {
      const r = await inlineSubresources(res.body, http, finalPath);
      if (!mounted.current || seq !== navSeq.current) return;
      if (r.notice) setNotice((n) => n ?? r.notice);
      setView({ kind: 'html', html: prepareHtml(r.html, finalPath), seq });   // seq 作 key：内容相同（↻）也重新载入
    } else if (kind === 'json') {
      setView({ kind: 'text', text: pretty(res.body) });
    } else if (kind === 'image') {
      const mime = String(res.contentType || 'image/png').split(';')[0].trim();
      setView({ kind: 'image', src: `data:${mime};base64,${res.body}` });
    } else if (kind === 'binary') {
      setView({ kind: 'binary', bytes: base64Bytes(res.body) });
    } else {
      setView({ kind: 'text', text: String(res.body ?? '') });
    }
  }, [http]);

  // 挂载：打开首页
  useEffect(() => {
    go({ method: 'GET', path: home });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 学生成功运行后刷新当前页（只 GET，不重发 POST）
  useEffect(() => client.subscribe((ev) => {
    if (ev?.type !== 'run-end' || ev.kind !== 'run' || !ev.ok) return;
    const h = histRef.current;
    const path = h.list[h.idx] ?? home;
    go({ method: 'GET', path }, 'none');
  }), [client, go, home]);

  // iframe 消息
  useEffect(() => {
    const onMsg = (e) => {
      const f = iframeRef.current;
      if (!f || !f.contentWindow || e.source !== f.contentWindow) return;
      if (frameAway()) return;   // 跳走后的页面发来的消息一律忽略
      const m = handleMessage(e.data);
      if (!m) return;
      if (m.type === 'websim:external') {
        setNotice(NO_NET);
      } else if (m.type === 'websim:navigate') {
        go({ method: m.method, path: m.path, body: m.body, headers: m.headers });
      } else if (m.type === 'websim:fetch') {
        const target = f.contentWindow;
        const reply = (payload) => {
          // S3：只投给仍是本组件那一个、未被换掉的 iframe（换页 / 重建后丢弃；targetOrigin 只能是 '*'：iframe 是不透明源）
          if (!mounted.current || iframeRef.current !== f || !f.isConnected || f.contentWindow !== target || frameAway()) return;
          try {
            target.postMessage({ type: 'websim:response', id: m.id, ...payload }, '*');
          } catch {
            // iframe 已换页：忽略
          }
        };
        http(m.method, m.path, { body: m.body, headers: m.headers }).then(
          (res) => reply({ status: Number(res.status), headers: res.headers ?? {}, contentType: res.contentType ?? '', body: res.body ?? '', binary: !!res.binary }),
          (e2) => {
            const noApp = String(e2?.message) === 'no-app';
            reply({ status: noApp ? 502 : 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, contentType: 'text/plain; charset=utf-8', body: noApp ? NO_APP : errorText(e2), binary: false });
          },
        );
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [go, http]);

  const submitAddr = () => {
    const p = String(addr ?? '').trim();
    if (!p.startsWith('/') || p.startsWith('//')) {
      setInvalid(true);
      return;
    }
    go({ method: 'GET', path: p });
  };
  const jump = (idx) => {
    const path = hist.list[idx];
    if (path == null) return;
    setHist((h) => ({ ...h, idx }));
    go({ method: 'GET', path }, 'at', idx);
  };

  return (
    <Fill data-sandbox-websim="">
      <div style={frameStyle}>
        <Chrome
          addr={addr}
          setAddr={(v) => {
            setAddr(v);
            setInvalid(false);
          }}
          invalid={invalid}
          onSubmit={submitAddr}
          canBack={hist.idx > 0}
          canFwd={hist.idx >= 0 && hist.idx < hist.list.length - 1}
          onBack={() => jump(hist.idx - 1)}
          onFwd={() => jump(hist.idx + 1)}
          onReload={() => lastReq.current && go(lastReq.current, 'none')}
          status={status}
        />
        {notice && (
          <div role="status" style={{ padding: '4px 10px', background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 'var(--fs-sm)' }}>
            {notice}
          </div>
        )}
        <Body view={view} iframeRef={iframeRef} onFrameLoad={onFrameLoad} />
      </div>
    </Fill>
  );
}

export default function WebSim({ stageId, home = '/', onResponse }) {
  const st = useStudentStage(stageId);
  const start = typeof home === 'string' && home.startsWith('/') ? home : '/';
  if (st.readOnly) {
    return (
      <Fill data-sandbox-websim="">
        <div style={frameStyle}>
          <Chrome addr={start} status={null} disabled />
        </div>
      </Fill>
    );
  }
  return <LiveWebSim home={start} onResponse={onResponse} />;
}
