// createWorkerCore({ pyodide?, post, xhrFactory, loadPyodide?, fetchBytes?, now?, sleepSync? }) → { handle(msg) }
// 规格 §3.8：与环境无关的 Worker 核心（worker.js 只做 self.onmessage → core.handle；Node 冒烟直接驱动）
// - 每条请求带 id，严格串行（promise 链，包括 load / write）；init 前到达的请求排队，init 失败后一律 fail
// - 主线程 → Worker：init / load / write / run / test / http
// - Worker → 主线程：progress / ready / fail / done / out / stdin-request / image / result / test-result / http-result，
//   以及 fatal { id, message }（Pyodide 致命错误；主线程据此重建，§3.9）
// - 输出：write 模式 + 同步合批（距上次 flush ≥ 50 ms 或缓冲 ≥ 8 KB 立即 post；stdin-request 前、time.sleep 前、运行结束前强制 flush）；
//   累计超 1 MB 停止转发只计数，结束时 system 一条"输出过多"；结果里 stdout / stderr 保留尾部 200 KB
// - input()：同步 XHR 长轮询 stdinUrl/<runId>；204 继续；status 0 / 403 退避重试 3 次；其余抛"输入通道断开"
import SANDBOX_RT from './sandbox_rt.py.js';
import { parseJunit } from './parseJunit.js';
import { FLASK_DEPS, FLASK_WHEELS, FONT_PATH } from '../packages.js';

const FLUSH_MS = 50;
const FLUSH_CHARS = 8 * 1024;
const OUTPUT_LIMIT = 1024 * 1024;
const TAIL = 200 * 1024;
const IMAGE_LIMIT = 80000;
const MAX_IMAGES = 6;
const FONT_FILE = '/usr/share/fonts/sandbox/NotoSansSC-subset.otf';

const BOOTSTRAP = `
import site as _site, os as _os
_p = _os.path.join(_site.getsitepackages()[0], '_sandbox_rt.py')
_os.makedirs(_os.path.dirname(_p), exist_ok=True)
with open(_p, 'w', encoding='utf-8') as _f:
    _f.write(__sb_src)
del __sb_src, _p, _f, _site, _os
import _sandbox_rt
`;

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const busyWait = (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* 同步等待：Worker 里没有别的办法 */ }
};
const defaultFetchBytes = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
};
const defaultLoadPyodide = async (opts) => {
  const mod = await import(/* @vite-ignore */ `${opts.indexURL}pyodide.mjs`);
  return mod.loadPyodide(opts);
};

const isPythonError = (e) => e?.constructor?.name === 'PythonError' || e?.name === 'PythonError';
const isFatal = (e) => /fatal error/i.test(String(e?.message ?? ''));
const msgOf = (e) => String(e?.message ?? e ?? 'error');

export function createWorkerCore({
  pyodide = null,
  post,
  xhrFactory = () => new XMLHttpRequest(),
  loadPyodide = defaultLoadPyodide,
  fetchBytes = defaultFetchBytes,
  now = defaultNow,
  sleepSync = busyWait,
} = {}) {
  let py = null;
  let rt = null;
  let initError = null;
  let indexURL = '';
  let stdinUrl = '';
  let chain = Promise.resolve();
  let mplReady = false;
  let flaskReady = false;

  // ---------- 输出合批 ----------
  let currentId = null;
  let out = null;
  const decoders = {};
  const resetOutput = (id) => {
    currentId = id;
    out = { buf: '', kind: null, last: 0, total: 0, dropped: 0, stdout: '', stderr: '', lastLine: '', stdinBroken: false };
  };
  resetOutput(null);

  function flush() {
    if (out.buf) post({ type: 'out', id: currentId, kind: out.kind, text: out.buf });
    out.buf = '';
    out.last = now();
  }

  function emit(kind, text) {
    if (!text) return;
    if (kind === 'stdout') {
      out.stdout += text;
      if (out.stdout.length > 2 * TAIL) out.stdout = out.stdout.slice(-TAIL);
      const nl = text.lastIndexOf('\n');
      out.lastLine = (nl >= 0 ? text.slice(nl + 1) : out.lastLine + text).slice(-200);
    } else {
      out.stderr += text;
      if (out.stderr.length > 2 * TAIL) out.stderr = out.stderr.slice(-TAIL);
    }
    // 1 MB 转发上限：按剩余额度截断本次写入（单次大写入也不会整段发给主线程）
    const room = OUTPUT_LIMIT - out.total;
    if (room <= 0) {
      out.dropped += text.length;
      return;
    }
    let part = text;
    if (part.length > room) {
      out.dropped += part.length - room;
      part = part.slice(0, room);
    }
    out.total += part.length;
    if (out.kind && out.kind !== kind) flush();
    out.kind = kind;
    out.buf += part;
    if (out.buf.length >= FLUSH_CHARS || now() - out.last >= FLUSH_MS) flush();
  }

  function system(text) {
    flush();
    post({ type: 'out', id: currentId, kind: 'system', text });
  }

  function endOutput() {
    flush();
    if (out.dropped > 0) system(`输出过多，后面 ${out.dropped} 个字符未显示\n`);
    return { stdout: out.stdout.slice(-TAIL), stderr: out.stderr.slice(-TAIL) };
  }

  const writer = (kind) => ({
    write(buf) {
      decoders[kind] ??= new TextDecoder();
      emit(kind, decoders[kind].decode(buf, { stream: true }));
      return buf.length;
    },
  });

  // ---------- input()：同步 XHR ----------
  function readLine() {
    flush();
    post({ type: 'stdin-request', id: currentId, prompt: out.lastLine });
    const url = `${stdinUrl}/${currentId}`;
    for (let tries = 0; ;) {
      let status = 0;
      let text = '';
      try {
        const xhr = xhrFactory();
        xhr.open('GET', url, false);
        xhr.send();
        status = xhr.status;
        text = xhr.responseText;
      } catch {
        status = 0;
      }
      if (status === 200) {
        out.lastLine = '';
        let j;
        try {
          j = JSON.parse(text);
        } catch {
          j = { eof: true };
        }
        return j.eof ? null : `${String(j.line ?? '')}\n`;
      }
      if (status === 204) continue;
      if ((status === 0 || status === 403) && ++tries <= 3) {
        sleepSync(500 * tries);
        continue;
      }
      out.stdinBroken = true;
      throw new Error('输入通道断开');
    }
  }

  // ---------- 包加载后的补丁：matplotlib 字体、Flask ----------
  async function afterLoad() {
    const loaded = py.loadedPackages ?? {};
    if (!mplReady && loaded.matplotlib !== undefined) {
      mplReady = true;
      let fontPath = '';
      try {
        const bytes = await fetchBytes(indexURL + FONT_PATH);
        py.FS.mkdirTree(FONT_FILE.slice(0, FONT_FILE.lastIndexOf('/')));
        py.FS.writeFile(FONT_FILE, bytes);
        fontPath = FONT_FILE;
      } catch {
        // 字体取不到：中文显示为方块，不影响运行
      }
      rt.setup_mpl(fontPath);
    }
    if (!flaskReady && loaded.flask !== undefined) {
      flaskReady = true;
      rt.patch_flask();
    }
  }

  async function loadImports(code) {
    try {
      await py.loadPackagesFromImports(code, {
        messageCallback: (m) => {
          const names = /^Loading (.+)$/.exec(String(m))?.[1];
          if (names) system(`正在加载 ${names}…\n`);
        },
        errorCallback: () => {},
      });
    } catch {
      // 加载失败：让 Python 自己抛 ModuleNotFoundError
    }
    await afterLoad();
  }

  // ---------- 各消息 ----------
  async function init(msg) {
    const t0 = now();
    if (py) return post({ type: 'ready', id: msg.id, version: py.version, ms: 0 });
    indexURL = msg.indexURL;
    stdinUrl = msg.stdinUrl;
    post({ type: 'progress', id: msg.id, phase: 'core', detail: 'Python 运行时' });
    try {
      const p = pyodide ?? (await loadPyodide({ indexURL, lockFileURL: `${indexURL}pyodide-lock.json` }));
      p.setStdout(writer('stdout'));
      p.setStderr(writer('stderr'));
      p.setStdin({ stdin: readLine });
      p.registerJsModule('_sb_js', { flush: () => flush() });
      p.globals.set('__sb_src', SANDBOX_RT);
      await p.runPythonAsync(BOOTSTRAP);
      rt = p.pyimport('_sandbox_rt');
      py = p;
      await afterLoad();
      post({ type: 'ready', id: msg.id, version: p.version, ms: Math.round(now() - t0) });
    } catch (e) {
      initError = msgOf(e);
      post({ type: 'fail', id: msg.id, message: initError });
    }
  }

  async function load({ id, packages = [], flask = false }) {
    const t0 = now();
    const names = [...packages];
    if (flask) names.push(...FLASK_DEPS, ...FLASK_WHEELS.map((w) => `${indexURL}wheels/${w}`));
    if (names.length > 0) {
      post({ type: 'progress', id, phase: 'packages', detail: [...packages, ...(flask ? ['flask'] : [])].join(', ') });
      const errors = [];
      await py.loadPackage(names, { messageCallback: () => {}, errorCallback: (m) => errors.push(String(m)) });
      const loaded = py.loadedPackages ?? {};
      const missing = [...packages, ...(flask ? ['flask'] : [])].filter((n) => loaded[n] === undefined);
      if (missing.length > 0) throw new Error(`加载失败：${missing.join(', ')}${errors.length ? `（${errors[0]}）` : ''}`);
    }
    await afterLoad();
    post({ type: 'done', id, ms: Math.round(now() - t0) });
  }

  function write({ id, files = {} }) {
    rt.write_files(JSON.stringify(files));
    post({ type: 'done', id });
  }

  async function run({ id, code = '', files = {} }) {
    const t0 = now();
    resetOutput(id);
    if (files && Object.keys(files).length > 0) rt.write_files(JSON.stringify(files));
    await loadImports(code);
    const r = JSON.parse(rt.run(code));
    const figs = JSON.parse(rt.collect_figs(IMAGE_LIMIT, MAX_IMAGES));
    for (const [png, compact] of figs) post({ type: 'image', id, png, compact });
    const { stdout, stderr } = endOutput();
    if (out.stdinBroken && r.error) r.error = { ...r.error, type: 'OSError', message: '输入通道断开' };
    post({ type: 'result', id, ok: r.ok, value: r.value, error: r.error, stdout, stderr, ms: Math.round(now() - t0), interrupted: false });
  }

  async function test({ id, code = '', tests = {} }) {
    const t0 = now();
    resetOutput(id);
    if ((py.loadedPackages ?? {}).pytest === undefined) {
      system('正在加载 pytest…\n');
      let reason = '';
      try {
        await py.loadPackage(['pytest'], { messageCallback: () => {}, errorCallback: (m) => { reason ||= String(m); } });
      } catch (e) {
        reason = msgOf(e);
      }
      // 加载失败（多为网络）不是致命错误：回 fail，不触发重建
      if ((py.loadedPackages ?? {}).pytest === undefined) {
        endOutput();
        return post({ type: 'fail', id, message: `加载失败：pytest${reason ? `（${reason}）` : ''}` });
      }
    }
    await loadImports([code, ...Object.values(tests)].join('\n'));
    const xml = rt.run_tests(code, JSON.stringify(tests));
    rt.collect_figs(0, 0);   // 测试里画的图不展示，关掉避免串到下一次运行
    const { stdout } = endOutput();
    post({ type: 'test-result', id, ...parseJunit(xml), stdout, ms: Math.round(now() - t0) });
  }

  function http({ id, method = 'GET', path = '/', body = null, headers = {} }) {
    resetOutput(id);
    const r = JSON.parse(rt.http(JSON.stringify({ method, path, body, headers })));
    flush();
    if (r.noApp) return post({ type: 'fail', id, message: 'no-app' });
    post({ type: 'http-result', id, ...r });
  }

  const HANDLERS = { load, write, run, test, http };
  const USER_CODE = ['run', 'test', 'http'];

  async function process(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'init') return init(msg);
    const fn = HANDLERS[msg.type];
    if (!fn) return post({ type: 'fail', id: msg.id, message: `unknown message ${msg.type}` });
    if (!py) return post({ type: 'fail', id: msg.id, message: initError ? `初始化失败：${initError}` : 'not-initialized' });
    try {
      await fn(msg);
    } catch (e) {
      try {
        flush();
      } catch {
        // 忽略
      }
      if (isFatal(e) || (USER_CODE.includes(msg.type) && !isPythonError(e))) {
        post({ type: 'fatal', id: msg.id, message: msgOf(e) });
      } else {
        post({ type: 'fail', id: msg.id, message: msgOf(e) });
      }
    } finally {
      if (USER_CODE.includes(msg.type)) resetOutput(null);
    }
  }

  return {
    handle(msg) {
      chain = chain.then(() => process(msg)).catch(() => {});
      return chain;
    },
  };
}
