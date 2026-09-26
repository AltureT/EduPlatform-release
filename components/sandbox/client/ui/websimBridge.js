// 模拟浏览器桥接（规格 §3.5），纯函数：
// - bridgeScript()：注入 iframe 的脚本字符串。拦截 <a> 点击、<form> 提交（含 form.submit()）、fetch、XMLHttpRequest，
//   相对路径或 http://websim.invalid/... → postMessage 给父页面；外链（http/https 其他主机）不打开，只发 websim:external
// - prepareHtml(html, currentPath)：在 <head> 最前（没有 <head> 时在文档最前，doctype 之后）插入 CSP meta（S3）、<base> 与桥接脚本
// - inlineSubresources(html, http, currentPath)：把相对路径的样式表 / 图片 / 脚本经 http() 取回后内联（≤ 20 个、每个 ≤ 200 KB）
// - handleMessage(data)：父页面侧校验 iframe 消息形状，合法返回规范化对象，否则 null
// - externalLocation(res)：3xx 且 Location 指向外部主机时返回该 URL
// 父页面永远不对 iframe 发来的路径做真实 fetch：只经 pythonClient.http() 交给学生的 Flask app

export const WEBSIM_ORIGIN = 'http://websim.invalid';
const LOCAL_HOSTS = ['websim.invalid', 'localhost', '127.0.0.1'];
export const SUBRESOURCE_LIMITS = Object.freeze({ count: 20, bytes: 200 * 1024 });
// S3：iframe 内的内容安全策略。子资源都已由父页面内联（<style>、data: 图片、内联 <script>），所以默认一律不许出网：
// 绝对外链的 <img> / <link> / <script src>、字体、真实 fetch 都被浏览器拦下；表单一律由桥接在 submit 事件里
// preventDefault 后走 postMessage，不产生真实提交，form-action 'none' 只拦截绕过桥接的提交
export const WEBSIM_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'";

// iframe 里执行（sandbox 无 allow-same-origin，不透明源）。只引用 window 上的全局，便于在 jsdom 里用假 window 执行
const BRIDGE = `(function (w) {
  'use strict';
  var ORIGIN = 'http://websim.invalid';
  var doc = w.document;
  var parentWin = w.parent;
  var FORM = 'application/x-www-form-urlencoded';
  function post(msg) { try { parentWin.postMessage(msg, '*'); } catch (e) { /* 忽略 */ } }
  function baseHref() {
    var b = doc.querySelector('base[href]');
    return (b && b.href) || doc.baseURI || (ORIGIN + '/');
  }
  function classify(raw) {
    if (raw == null) return { kind: 'other' };
    var u;
    try { u = new w.URL(String(raw).trim(), baseHref()); } catch (e) { return { kind: 'other' }; }
    if (u.origin === ORIGIN) return { kind: 'internal', path: (u.pathname || '/') + u.search };
    if (u.protocol === 'http:' || u.protocol === 'https:') return { kind: 'external', url: u.href };
    return { kind: 'other' };
  }
  function external(url) { post({ type: 'websim:external', url: url }); }
  function formParams(form, submitter) {
    var fd;
    try { fd = submitter ? new w.FormData(form, submitter) : new w.FormData(form); } catch (e) { fd = new w.FormData(form); }
    var p = new w.URLSearchParams();
    fd.forEach(function (v, k) { p.append(k, typeof v === 'string' ? v : ((v && v.name) || '')); });
    return p;
  }
  function submitForm(form, submitter) {
    var method = String((submitter && submitter.getAttribute && submitter.getAttribute('formmethod')) || form.getAttribute('method') || 'GET').toUpperCase();
    if (method !== 'POST') method = 'GET';
    var action = (submitter && submitter.getAttribute && submitter.getAttribute('formaction')) || form.getAttribute('action') || '';
    var c = classify(action === '' ? baseHref() : action);
    if (c.kind === 'external') { external(c.url); return; }
    if (c.kind !== 'internal') return;
    var params = formParams(form, submitter).toString();
    if (method === 'GET') {
      var p = c.path.split('?')[0];
      post({ type: 'websim:navigate', method: 'GET', path: params ? p + '?' + params : p });
    } else {
      post({ type: 'websim:navigate', method: 'POST', path: c.path, body: params, headers: { 'Content-Type': FORM } });
    }
  }

  doc.addEventListener('click', function (e) {
    if (e.defaultPrevented || (e.button && e.button !== 0)) return;
    var t = e.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    var raw = a.getAttribute('href') || '';
    if (raw.charAt(0) === '#') {
      e.preventDefault();
      var id = raw.slice(1);
      try { id = decodeURIComponent(id); } catch (err) { /* 原样 */ }
      var el = id ? doc.getElementById(id) : null;
      if (el && el.scrollIntoView) el.scrollIntoView();
      return;
    }
    var c = classify(raw);
    if (c.kind === 'internal') { e.preventDefault(); post({ type: 'websim:navigate', method: 'GET', path: c.path }); }
    else if (c.kind === 'external') { e.preventDefault(); external(c.url); }
  });

  doc.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var form = e.target;
    if (!form || String(form.tagName).toUpperCase() !== 'FORM') return;
    e.preventDefault();
    submitForm(form, e.submitter || null);
  });
  try {
    if (w.HTMLFormElement && w.HTMLFormElement.prototype) {
      w.HTMLFormElement.prototype.submit = function () { submitForm(this, null); };
    }
  } catch (e) { /* 忽略 */ }

  // ---- fetch / XMLHttpRequest ----
  var pending = {};
  var seq = 0;
  w.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var d = e.data;
    if (!d || d.type !== 'websim:response' || !pending[d.id]) return;
    var cb = pending[d.id];
    delete pending[d.id];
    cb(d);
  });
  function request(method, path, body, headers) {
    return new Promise(function (resolve) {
      seq += 1;
      var id = seq;
      pending[id] = resolve;
      post({ type: 'websim:fetch', id: id, method: method, path: path, body: body, headers: headers });
    });
  }
  function bytesOf(d) {
    if (!d.binary) return d.body == null ? '' : String(d.body);
    var bin = w.atob(String(d.body || ''));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function bodyString(b) {
    if (b == null) return null;
    if (typeof b === 'string') return b;
    if (w.URLSearchParams && b instanceof w.URLSearchParams) return b.toString();
    if (w.FormData && b instanceof w.FormData) {
      var p = new w.URLSearchParams();
      b.forEach(function (v, k) { p.append(k, typeof v === 'string' ? v : ((v && v.name) || '')); });
      return p.toString();
    }
    return String(b);
  }
  function isForm(b) {
    return (w.URLSearchParams && b instanceof w.URLSearchParams) || (w.FormData && b instanceof w.FormData);
  }
  function headerObject(h) {
    var o = {};
    if (!h) return o;
    try { new w.Headers(h).forEach(function (v, k) { o[k] = v; }); } catch (e) { /* 忽略 */ }
    return o;
  }

  var realFetch = w.fetch;
  w.fetch = function (input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : ((input && input.url) || String(input));
    var c = classify(url);
    if (c.kind === 'external') {
      external(c.url);
      return Promise.reject(new TypeError('模拟浏览器不能访问外网'));
    }
    if (c.kind !== 'internal') {
      return realFetch ? realFetch.apply(w, arguments) : Promise.reject(new TypeError('unsupported'));
    }
    var method = String(init.method || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    var headers = headerObject(init.headers);
    if (isForm(init.body) && !headers['content-type']) headers['content-type'] = FORM + ';charset=UTF-8';
    return request(method, c.path, bodyString(init.body), headers).then(function (d) {
      var status = Number(d.status) || 0;
      if (status < 200 || status > 599) status = 502;
      var body = status === 204 || status === 205 || status === 304 ? null : bytesOf(d);
      try { return new w.Response(body, { status: status, headers: d.headers || {} }); }
      catch (e) { return new w.Response(body, { status: status }); }
    });
  };

  function SimXHR() {
    this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = ''; this.response = '';
    this.responseType = ''; this.responseURL = ''; this.timeout = 0; this.withCredentials = false;
    this.onreadystatechange = null; this.onload = null; this.onerror = null; this.onloadend = null; this.onabort = null;
    this.upload = { addEventListener: function () {}, removeEventListener: function () {} };
    this._h = {}; this._rh = {}; this._l = {}; this._aborted = false;
  }
  SimXHR.UNSENT = 0; SimXHR.OPENED = 1; SimXHR.HEADERS_RECEIVED = 2; SimXHR.LOADING = 3; SimXHR.DONE = 4;
  var X = SimXHR.prototype;
  X.UNSENT = 0; X.OPENED = 1; X.HEADERS_RECEIVED = 2; X.LOADING = 3; X.DONE = 4;
  X._fire = function (type) {
    var ev = { type: type, target: this, currentTarget: this };
    var h = this['on' + type];
    var list = (this._l[type] || []).slice();
    if (typeof h === 'function') list.unshift(h);
    for (var i = 0; i < list.length; i++) {
      try { list[i].call(this, ev); } catch (err) { setTimeout(function () { throw err; }, 0); }
    }
  };
  X.addEventListener = function (t, fn) { (this._l[t] = this._l[t] || []).push(fn); };
  X.removeEventListener = function (t, fn) {
    var a = this._l[t];
    if (!a) return;
    var i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  };
  X.open = function (method, url) {
    this._m = String(method || 'GET').toUpperCase();
    this._c = classify(url);
    this._h = {};
    this._aborted = false;
    this.readyState = 1;
    this._fire('readystatechange');
  };
  X.setRequestHeader = function (k, v) { this._h[String(k).toLowerCase()] = String(v); };
  X.overrideMimeType = function () {};
  X.getResponseHeader = function (k) {
    var v = this._rh[String(k).toLowerCase()];
    return v == null ? null : v;
  };
  X.getAllResponseHeaders = function () {
    var s = '';
    for (var k in this._rh) s += k + ': ' + this._rh[k] + '\\r\\n';
    return s;
  };
  X.abort = function () {
    this._aborted = true;
    if (this.readyState > 0 && this.readyState < 4) {
      this.readyState = 4;
      this._fire('readystatechange');
      this._fire('abort');
      this._fire('loadend');
    }
    this.readyState = 0;
  };
  X.send = function (body) {
    var self = this;
    var c = this._c;
    if (!c || c.kind !== 'internal') {
      if (c && c.kind === 'external') external(c.url);
      setTimeout(function () {
        self.readyState = 4;
        self._fire('readystatechange');
        self._fire('error');
        self._fire('loadend');
      }, 0);
      return;
    }
    if (isForm(body) && !this._h['content-type']) this._h['content-type'] = FORM + ';charset=UTF-8';
    request(this._m, c.path, bodyString(body), this._h).then(function (d) {
      if (self._aborted) return;
      self.status = Number(d.status) || 0;
      self.responseURL = ORIGIN + c.path;
      self._rh = {};
      var hs = d.headers || {};
      for (var k in hs) self._rh[k.toLowerCase()] = String(hs[k]);
      var text = d.binary ? '' : String(d.body == null ? '' : d.body);
      self.responseText = text;
      if (self.responseType === 'json') {
        try { self.response = JSON.parse(text); } catch (e) { self.response = null; }
      } else if (self.responseType === 'arraybuffer') {
        var b = bytesOf(d);
        self.response = typeof b === 'string' ? new TextEncoder().encode(b).buffer : b.buffer;
      } else {
        self.response = text;
      }
      self.readyState = 2; self._fire('readystatechange');
      self.readyState = 3; self._fire('readystatechange');
      self.readyState = 4; self._fire('readystatechange');
      self._fire('load');
      self._fire('loadend');
    });
  };
  w.XMLHttpRequest = SimXHR;
})(window);`;

export function bridgeScript() {
  return BRIDGE;
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const normPath = (p) => (typeof p === 'string' && p.startsWith('/') ? p : `/${p ?? ''}`);

export function prepareHtml(html, currentPath = '/') {
  const src = String(html ?? '');
  // CSP meta 必须在任何子资源与脚本之前（只约束其后的内容）
  const inject = `<meta http-equiv="Content-Security-Policy" content="${WEBSIM_CSP}">`
    + `<base href="${escapeAttr(WEBSIM_ORIGIN + normPath(currentPath))}"><script>${bridgeScript()}</script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(src);
  if (head) {
    const at = head.index + head[0].length;
    return src.slice(0, at) + inject + src.slice(at);
  }
  const dt = /^\s*<!doctype[^>]*>/i.exec(src);
  if (dt) return src.slice(0, dt[0].length) + inject + src.slice(dt[0].length);
  return inject + src;
}

// ---------- 子资源内联 ----------

const ATTR = (name) => new RegExp(`(\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
function attrOf(tag, name) {
  const m = ATTR(name).exec(tag);
  if (!m) return null;
  return m[3] ?? m[4] ?? m[5] ?? '';
}
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// 相对路径或 websim.invalid 绝对路径 → 应用内路径；外链、data: 等 → null
export function resolvePath(ref, currentPath = '/') {
  if (typeof ref !== 'string' || ref.trim() === '') return null;
  let u;
  try {
    u = new URL(decodeEntities(ref.trim()), WEBSIM_ORIGIN + normPath(currentPath));
  } catch {
    return null;
  }
  return u.origin === WEBSIM_ORIGIN ? (u.pathname || '/') + u.search : null;
}

function byteLength(res) {
  const body = String(res.body ?? '');
  if (res.binary) return Math.floor((body.length * 3) / 4);
  try {
    return new TextEncoder().encode(body).length;
  } catch {
    return body.length;
  }
}
const mimeOf = (res, fallback) => String(res.contentType || '').split(';')[0].trim() || fallback;
const noCloseTag = (text, tag) => String(text).replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

export async function inlineSubresources(html, http, currentPath = '/', { count: maxCount = SUBRESOURCE_LIMITS.count, bytes: maxBytes = SUBRESOURCE_LIMITS.bytes } = {}) {
  const src = String(html ?? '');
  const found = [];
  let m;
  const linkRe = /<link\b[^>]*>/gi;
  while ((m = linkRe.exec(src))) {
    const tag = m[0];
    const rel = (attrOf(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet')) continue;
    const path = resolvePath(attrOf(tag, 'href'), currentPath);
    if (path) found.push({ kind: 'css', start: m.index, end: m.index + tag.length, tag, path });
  }
  const imgRe = /<img\b[^>]*>/gi;
  while ((m = imgRe.exec(src))) {
    const path = resolvePath(attrOf(m[0], 'src'), currentPath);
    if (path) found.push({ kind: 'img', start: m.index, end: m.index + m[0].length, tag: m[0], path });
  }
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  while ((m = scriptRe.exec(src))) {
    const attrs = m[1];
    const path = resolvePath(attrOf(` ${attrs}`, 'src'), currentPath);
    if (path) found.push({ kind: 'js', start: m.index, end: m.index + m[0].length, tag: m[0], attrs, path });
  }
  found.sort((a, b) => a.start - b.start);

  const cache = new Map();
  let fetched = 0;
  let skipped = 0;
  const outcome = async (path) => {
    if (cache.has(path)) return cache.get(path);
    let r;
    if (fetched >= maxCount) {
      r = { skip: true };
    } else {
      fetched++;
      try {
        const res = await http('GET', path);
        if (!res || res.status >= 400) r = { fail: true };
        else if (byteLength(res) > maxBytes) r = { skip: true };
        else r = { res };
      } catch {
        r = { fail: true };
      }
    }
    cache.set(path, r);
    return r;
  };

  let out = '';
  let pos = 0;
  for (const f of found) {
    const o = await outcome(f.path);
    if (o.skip) skipped++;
    let rep;
    if (f.kind === 'css') {
      rep = o.res ? `<style>${noCloseTag(o.res.body ?? '', 'style')}</style>` : '';
    } else if (f.kind === 'img') {
      let url = '';
      if (o.res) {
        const mime = mimeOf(o.res, 'application/octet-stream');
        url = o.res.binary ? `data:${mime};base64,${o.res.body}` : `data:${mime};charset=utf-8,${encodeURIComponent(o.res.body ?? '')}`;
      }
      rep = f.tag.replace(ATTR('src'), (_all, sp) => `${sp}src="${escapeAttr(url)}"`);
    } else {
      const attrs = f.attrs.replace(ATTR('src'), '');
      const body = o.res && !o.res.binary ? noCloseTag(o.res.body ?? '', 'script') : '';
      rep = `<script${attrs}>${body}</script>`;
    }
    out += src.slice(pos, f.start) + rep;
    pos = f.end;
  }
  out += src.slice(pos);
  const notice = skipped > 0
    ? `有 ${skipped} 个资源超出限制（最多 ${maxCount} 个、每个 ${Math.round(maxBytes / 1024)} KB），未加载`
    : null;
  return { html: out, skipped, notice };
}

// ---------- 父页面侧：消息校验 ----------

const METHODS_NAV = ['GET', 'POST'];
const METHODS_FETCH = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_BODY = 1024 * 1024;
const okPath = (p) => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && p.length <= 4096 && !/[\s\\]/.test(p);
const okBody = (b) => b == null || (typeof b === 'string' && b.length <= MAX_BODY);
function okHeaders(h) {
  if (h == null) return {};
  if (typeof h !== 'object' || Array.isArray(h)) return null;
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (typeof v !== 'string' || k.length > 256 || v.length > 8192) return null;
    out[k] = v;
  }
  return out;
}

export function handleMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'websim:external') {
    return typeof data.url === 'string' && data.url.length <= 4096 ? { type: 'websim:external', url: data.url } : null;
  }
  if (data.type !== 'websim:navigate' && data.type !== 'websim:fetch') return null;
  const method = typeof data.method === 'string' ? data.method.toUpperCase() : '';
  const allowed = data.type === 'websim:navigate' ? METHODS_NAV : METHODS_FETCH;
  if (!allowed.includes(method) || !okPath(data.path) || !okBody(data.body)) return null;
  const headers = okHeaders(data.headers);
  if (!headers) return null;
  const msg = { type: data.type, method, path: data.path, body: data.body ?? null, headers };
  if (data.type === 'websim:fetch') {
    if (!Number.isInteger(data.id) || data.id < 0) return null;
    msg.id = data.id;
  }
  return msg;
}

export function headerOf(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want) return v;
  return null;
}

export function externalLocation(res) {
  const status = Number(res?.status);
  if (!(status >= 300 && status < 400)) return null;
  const loc = headerOf(res.headers, 'location');
  if (typeof loc !== 'string' || !loc) return null;
  let u;
  try {
    u = new URL(loc, `${WEBSIM_ORIGIN}/`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return LOCAL_HOSTS.includes(u.hostname) ? null : u.href;
}
