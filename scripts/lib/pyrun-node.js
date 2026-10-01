// Node 里的 Python 运行器（代码题测试验证规格 §3）：备课时用参考答案跑 pytest、生成"改坏一处"的变体。
//   createPyRunner({ pyodideDir?, root?, log?, workerURL?, workerData?, onWorker?, initTimeoutMs? }) → runner
//     runner.available / runner.reason（不可用时的一句中文）
//     await runner.runTests(code, tests, { files, timeoutMs = 20000 }) → { passed, failed, errors, total, cases: [{ name, ok, reason }], ms, timedOut? }
//       files = 有效 sandbox 配置的 files（{ 相对路径: 文本 }，路径规则同学生端），写 main.py 之前先写进工作目录
//     await runner.mutants(source, { max = 20, includeMain = false }) → [{ id, line, desc, code }]
//       includeMain：测试用 runpy 跑 __main__ 时为真，顶层 if __name__ == '__main__': 块里也生成变体
//     await runner.evalCases(code, cases, { files, timeoutMs = 10000 }) → [{ ok, repr? , error?, timedOut? }]（代码题批改规格 §3.2）
//       cases = [{ call } | { stdin: [行] }]；call → repr(eval(call, vars(main)))，stdin → 喂 input() 跑 __main__ 取 repr(stdout.rstrip())
//     await runner.reset() → 清空工作目录 /work（每段开始前调，上一段的数据文件不留）
//     runTests / mutants / reset 可带 initTimeoutMs：这次若要（重）建 worker，初始化超时取 min(构造时的 initTimeoutMs, 它)；
//       因此超时 → 不判不可用，按本次调用超时处理（runTests 返回 timedOut，mutants / reset 抛带 timedOut 的错）
//     await runner.close()
// Pyodide 跑在 node:worker_threads 的独立线程（pyrun-worker.js）；每次调用带超时，超时 → terminate，下次调用重建。
// 只从本地 vendor/pyodide/v<版本>/ 加载，不出网（worker 里挡掉 http(s) 请求）。workerURL / workerData / onWorker 供单测注入假 worker。
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { PYODIDE_VERSION } from '../../components/sandbox/packages.js';
import { parseJunit } from '../../components/sandbox/client/parseJunit.js';

export const NOT_DOWNLOADED = 'Python 环境还没准备好（工作台会自动准备，没好时到 平台 → 环境与版本 看状态）';
// 缓存键里的运行器版本：Python 逻辑或 Pyodide 版本变了，旧缓存自动失效
// Windows 修正（用户 2026-10-01 在 Windows 实测代码题"测试没验证"）：Pyodide 在 Node 里从 lockFileURL 推包目录时只认正斜杠
//   （calculateInstallBaseUrl 用 lastIndexOf("/")），反斜杠路径会推成 "./"，pytest 的 wheel 从当前目录读 → 装不上。
//   所以给 loadPyodide 的三个路径一律用正斜杠，并显式传 packageBaseUrl（不让它自己推）；fs.readFile 两种斜杠都认。
export function pyodideLoadOptions(dir) {
  const base = String(dir).replace(/\\/g, '/').replace(/\/?$/, '/');
  return { indexURL: base, lockFileURL: `${base}pyodide-lock.json`, packageBaseUrl: base };
}
export const PYRUN_VERSION = `pyrun-1+pyodide-${PYODIDE_VERSION}`;
// 同 code 原语 primitive.config.js 的 TEST_NAME_RE
export const TEST_NAME_RE = /^[A-Za-z0-9_]+\.py$/;
// 同 code 原语 / sandbox 组件的 files 路径规则：相对路径、不含 .. 与反斜杠、不以 / 开头、非空
export const validRelPath = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0')
  && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKER = new URL('./pyrun-worker.js', import.meta.url);

// 平台目录下的 Pyodide 目录：按工作台 pyodideInfo 的规则读 vendor/pyodide/manifest.json → vendor/pyodide/v<版本>/
export function resolvePyodideDir(root = DEFAULT_ROOT) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'pyodide', 'manifest.json'), 'utf8'));
    const version = m?.version ?? PYODIDE_VERSION;
    return { dir: path.join(root, 'vendor', 'pyodide', `v${version}`) + path.sep, reason: null };
  } catch {
    return { dir: null, reason: NOT_DOWNLOADED };
  }
}

// 目录齐不齐：目录在、有 pyodide.mjs、lock 里 pytest 的轮子在
function checkDir(dir) {
  if (!dir || !fs.existsSync(dir)) return NOT_DOWNLOADED;
  if (!fs.existsSync(path.join(dir, 'pyodide.mjs'))) return 'Python 环境不完整：缺 pyodide.mjs（工作台会自动准备，没好时到 平台 → 环境与版本 看状态）';
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'pyodide-lock.json'), 'utf8'));
    const file = lock?.packages?.pytest?.file_name;
    if (file && fs.existsSync(path.join(dir, file))) return null;
  } catch {
    // 落到下面
  }
  return 'Python 环境不完整：缺 pytest（工作台会自动准备，没好时到 平台 → 环境与版本 看状态）';
}

export function createPyRunner({
  pyodideDir,
  root = DEFAULT_ROOT,
  log = () => {},
  workerURL = WORKER,
  workerData = {},
  onWorker,
  initTimeoutMs = 60_000,
} = {}) {
  let dir = pyodideDir ? (pyodideDir.endsWith(path.sep) ? pyodideDir : pyodideDir + path.sep) : null;
  let reason = null;
  if (!dir) ({ dir, reason } = resolvePyodideDir(root));
  if (!reason) reason = checkDir(dir);

  const runner = { available: !reason, reason };
  let worker = null;       // 当前 worker（null = 还没起或已结束）
  let ready = null;        // 当前 worker 的 init Promise
  let nextId = 1;
  const pending = new Map(); // id → { resolve, reject, timer }

  function failAll(err) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  function kill() {
    const w = worker;
    worker = null;
    ready = null;
    if (w) {
      w.removeAllListeners('message');
      return w.terminate().then(() => {}, () => {});
    }
    return Promise.resolve();
  }

  // 发一条消息等回复；超时 → 结束 worker，reject 一个带 timedOut 的错误
  function send(msg, timeoutMs) {
    const w = worker;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        kill();
        const e = new Error(`Python 运行超过 ${Math.round(timeoutMs / 100) / 10} 秒没有完成`);
        e.timedOut = true;
        reject(e);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      w.postMessage({ ...msg, id });
    });
  }

  function spawn(limitMs = initTimeoutMs) {
    const w = new Worker(workerURL, { workerData: { ...workerData } });
    worker = w;
    onWorker?.(w);
    w.on('message', (m) => {
      const p = pending.get(m?.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(String(m.message ?? 'Python 运行出错')));
    });
    w.once('error', (err) => {
      if (worker === w) { worker = null; ready = null; }
      failAll(err);
    });
    w.once('exit', (code) => {
      if (worker === w) {
        worker = null;
        ready = null;
        failAll(new Error(`Python 运行线程意外结束（${code}）`));
      }
    });
    const t0 = Date.now();
    const budgetLimited = limitMs < initTimeoutMs;
    ready = send({ type: 'init', indexURL: dir }, Math.max(1, Math.min(initTimeoutMs, limitMs))).then(
      () => log(`Pyodide 就绪（${Date.now() - t0} ms）`),
      (err) => {
        kill();
        if (err?.timedOut && budgetLimited) throw err; // 调用方预算不够起动：只算这次超时，下次再建
        runner.available = false;
        runner.reason = `Python 运行时起不来：${String(err?.message ?? err).split('\n')[0]}`;
        throw new Error(runner.reason);
      },
    );
    return ready;
  }

  async function ensure(limitMs) {
    if (!runner.available) throw new Error(runner.reason);
    if (!worker) await spawn(limitMs ?? initTimeoutMs);
    else await ready;
  }

  runner.runTests = async (code, tests, { files = {}, timeoutMs = 20_000, initTimeoutMs: initLimit } = {}) => {
    if (!runner.available) throw new Error(runner.reason);
    for (const name of Object.keys(tests ?? {})) {
      if (!TEST_NAME_RE.test(name)) throw new Error(`tests 的文件名 ${JSON.stringify(name)} 不合法（字母、数字、下划线，以 .py 结尾）`);
    }
    for (const [p, text] of Object.entries(files ?? {})) {
      if (!validRelPath(p)) throw new Error(`files 的路径 ${JSON.stringify(p)} 不合法（相对路径，不含 ..）`);
      if (typeof text !== 'string') throw new Error(`files[${JSON.stringify(p)}] 必须是文本`);
    }
    const t0 = Date.now(); // 含（重）建 worker 的时间：计入调用方的总预算
    try {
      await ensure(initLimit);
      const r = await send({ type: 'tests', code: String(code), tests, files: files ?? {} }, timeoutMs);
      const j = parseJunit(r?.junit ?? '');
      return {
        passed: j.passed,
        failed: j.failed,
        errors: j.errors,
        total: j.total,
        cases: j.cases.map((c) => ({ name: c.name, ok: c.ok, reason: c.message ?? '' })),
        ms: Date.now() - t0,
      };
    } catch (err) {
      if (!err?.timedOut) throw err;
      return { passed: 0, failed: 0, errors: 0, total: 0, cases: [], ms: Date.now() - t0, timedOut: true };
    }
  };

  // 代码题批改规格 §3.2：逐条求值（每条一次调用，各自带超时；超时 → 该条 { ok:false, timedOut }，worker 下次重建）
  runner.evalCases = async (code, cases, { files = {}, timeoutMs = 10_000, initTimeoutMs: initLimit } = {}) => {
    if (!runner.available) throw new Error(runner.reason);
    for (const [p, text] of Object.entries(files ?? {})) {
      if (!validRelPath(p)) throw new Error(`files 的路径 ${JSON.stringify(p)} 不合法（相对路径，不含 ..）`);
      if (typeof text !== 'string') throw new Error(`files[${JSON.stringify(p)}] 必须是文本`);
    }
    const out = [];
    for (const c of cases ?? []) {
      const one = c?.call !== undefined ? { call: String(c.call) } : { stdin: (c?.stdin ?? []).map(String) };
      try {
        await ensure(initLimit);
        out.push(await send({ type: 'eval', code: String(code), case: one, files: files ?? {} }, timeoutMs));
      } catch (err) {
        if (!err?.timedOut) throw err;
        out.push({ ok: false, error: `超过 ${Math.round(timeoutMs / 1000)} 秒没有完成`, timedOut: true });
      }
    }
    return out;
  };

  runner.mutants = async (source, { max = 20, timeoutMs = 20_000, includeMain = false, initTimeoutMs: initLimit } = {}) => {
    await ensure(initLimit);
    return send({ type: 'mutants', source: String(source), max, includeMain: Boolean(includeMain) }, timeoutMs);
  };

  runner.reset = async ({ timeoutMs = 20_000, initTimeoutMs: initLimit } = {}) => {
    await ensure(initLimit);
    await send({ type: 'reset' }, timeoutMs);
  };

  runner.close = async () => {
    failAll(new Error('Python 运行器已关闭'));
    await kill();
  };

  return runner;
}

// ── Python 端（worker 里执行一次）：写文件 / 清模块缓存 / 跑 pytest，和 ast 变体生成 ──
// 语义同学生端 components/sandbox/client/sandbox_rt.py.js 的 run_tests（不 import 它：它绑着 worker 的输出通道）
export const PYRUN_PY = String.raw`
import ast, copy, importlib, json, os, shutil, sys

sys.dont_write_bytecode = True  # 变体只改一个字符时 mtime/大小可能不变，不能用旧 .pyc

WORK = '/work'
os.makedirs(WORK, exist_ok=True)
os.chdir(WORK)


def pyrun_reset():
    # 每段开始前清空工作目录（上一段的数据文件、测试、main.py 都不留）
    os.chdir('/')
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)
    os.chdir(WORK)
    return ''


def _check_path(p):
    if not isinstance(p, str) or p == '' or p.startswith('/') or '\\' in p:
        raise ValueError('bad path: %r' % (p,))
    for seg in p.split('/'):
        if seg in ('', '.', '..'):
            raise ValueError('bad path: %r' % (p,))


def _write_main(code, files):
    os.chdir(WORK)
    # 数据文件先写（同段同一份，每次覆盖写；不清），参考答案与变体都读得到
    for p in files:
        _check_path(p)
    for p, text in files.items():
        d = os.path.dirname(p)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
    with open('main.py', 'w', encoding='utf-8') as f:
        f.write(code)


def pyrun_tests(code, tests_json, files_json='{}'):
    tests = json.loads(tests_json)
    files = json.loads(files_json)
    _write_main(code, files)
    if os.path.isdir('tests'):
        shutil.rmtree('tests')
    os.makedirs('tests')
    for name, src in tests.items():
        with open(os.path.join('tests', name), 'w', encoding='utf-8') as f:
            f.write(src)
    for m in list(sys.modules):
        if m in ('main', 'tests') or m.startswith('tests.') or m.startswith('test_'):
            del sys.modules[m]
    importlib.invalidate_caches()
    if WORK not in sys.path:
        sys.path.insert(0, WORK)
    junit = '/tmp/junit.xml'
    try:
        os.remove(junit)
    except OSError:
        pass
    import pytest
    pytest.main(['-q', '-p', 'no:cacheprovider', '--junitxml=' + junit, 'tests'])
    try:
        with open(junit, encoding='utf-8') as f:
            return f.read()
    except OSError:
        return ''


def pyrun_eval(code, case_json, files_json='{}'):
    # 代码题批改规格 §3.2：call → repr(eval(call, vars(main)))；stdin → 逐行喂 input()、run_path 跑 __main__，repr(stdout.rstrip())
    case = json.loads(case_json)
    _write_main(code, json.loads(files_json))
    for m in list(sys.modules):
        if m == 'main':
            del sys.modules[m]
    importlib.invalidate_caches()
    if WORK not in sys.path:
        sys.path.insert(0, WORK)
    import builtins, contextlib, io, runpy
    try:
        if 'call' in case:
            main = importlib.import_module('main')
            v = eval(case['call'], vars(main))
        else:
            feed = iter(case.get('stdin') or [])
            old = builtins.input
            builtins.input = lambda prompt='': next(feed)
            buf = io.StringIO()
            try:
                with contextlib.redirect_stdout(buf):
                    runpy.run_path('main.py', run_name='__main__')
            finally:
                builtins.input = old
            v = buf.getvalue().rstrip()
        return json.dumps({'ok': True, 'repr': repr(v)}, ensure_ascii=False)
    except BaseException as e:
        return json.dumps({'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}, ensure_ascii=False)


_CMP = {ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt, ast.Eq: ast.NotEq, ast.NotEq: ast.Eq}
_CMP_SYM = {ast.Lt: '<', ast.LtE: '<=', ast.Gt: '>', ast.GtE: '>=', ast.Eq: '==', ast.NotEq: '!='}
_BIN = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.FloorDiv, ast.FloorDiv: ast.Mult}
_BIN_SYM = {ast.Add: '+', ast.Sub: '-', ast.Mult: '*', ast.FloorDiv: '//'}
_ORDER = ['cmp', 'int', 'bool', 'bin', 'if', 'ret']


def _nodes(tree):
    # 源码顺序（行、列），同位置按 walk 顺序；返回下标可在深拷贝里定位同一节点
    out = [n for n in ast.walk(tree) if hasattr(n, 'lineno')]
    idx = {id(n): i for i, n in enumerate(ast.walk(tree))}
    out.sort(key=lambda n: (n.lineno, n.col_offset, idx[id(n)]))
    return out, idx


def _candidates(tree, include_main=False):
    # 每类按源码顺序的候选：(类, 节点在 walk 里的下标, 参数, 行, 描述)
    nodes, idx = _nodes(tree)
    # 顶层 if __name__ == '__main__': 块是示例调用，测试 import main 时不执行，改它测试必然抓不住，不生成变体
    skip = set()
    for top in ([] if include_main else tree.body):
        if isinstance(top, ast.If) and isinstance(top.test, ast.Compare) and isinstance(top.test.left, ast.Name) and top.test.left.id == '__name__':
            skip.update(id(x) for x in ast.walk(top))
    cands = {k: [] for k in _ORDER}
    for n in nodes:
        if id(n) in skip:
            continue
        i = idx[id(n)]
        line = n.lineno
        if isinstance(n, ast.Compare):
            for k, op in enumerate(n.ops):
                t = type(op)
                if t in _CMP:
                    cands['cmp'].append((i, ('cmp', k), line, '第 %d 行 %s 改成 %s' % (line, '\x60' + _CMP_SYM[t] + '\x60', '\x60' + _CMP_SYM[_CMP[t]] + '\x60')))
        elif isinstance(n, ast.Constant) and type(n.value) is int:
            for d in (1, -1):
                cands['int'].append((i, ('int', d), line, '第 %d 行 %s 改成 %s' % (line, '\x60%d\x60' % n.value, '\x60%d\x60' % (n.value + d))))
        elif isinstance(n, ast.BoolOp):
            a, b = ('and', 'or') if isinstance(n.op, ast.And) else ('or', 'and')
            cands['bool'].append((i, ('bool',), line, '第 %d 行 \x60%s\x60 改成 \x60%s\x60' % (line, a, b)))
        elif isinstance(n, (ast.BinOp, ast.AugAssign)) and type(n.op) in _BIN:
            t = type(n.op)
            a, b = _BIN_SYM[t], _BIN_SYM[_BIN[t]]
            if isinstance(n, ast.AugAssign):
                a, b = a + '=', b + '='
            cands['bin'].append((i, ('bin',), line, '第 %d 行 \x60%s\x60 改成 \x60%s\x60' % (line, a, b)))
        elif isinstance(n, ast.If):
            cands['if'].append((i, ('if',), line, '第 %d 行 if 条件取反' % line))
        elif isinstance(n, ast.Return) and n.value is not None and not (isinstance(n.value, ast.Constant) and n.value.value is None):
            cands['ret'].append((i, ('ret',), line, '第 %d 行 \x60return …\x60 改成 \x60return None\x60' % line))
    return cands


def _apply(tree, i, arg):
    t = copy.deepcopy(tree)
    n = list(ast.walk(t))[i]
    kind = arg[0]
    if kind == 'cmp':
        n.ops[arg[1]] = _CMP[type(n.ops[arg[1]])]()
    elif kind == 'int':
        n.value = n.value + arg[1]
    elif kind == 'bool':
        n.op = ast.Or() if isinstance(n.op, ast.And) else ast.And()
    elif kind == 'bin':
        n.op = _BIN[type(n.op)]()
    elif kind == 'if':
        n.test = ast.UnaryOp(op=ast.Not(), operand=n.test)
    elif kind == 'ret':
        n.value = ast.Constant(value=None)
    ast.fix_missing_locations(t)
    return ast.unparse(t)


def pyrun_mutants(source, max_n, include_main=False):
    tree = ast.parse(source)  # 语法错直接抛 SyntaxError
    base = ast.unparse(tree)
    cands = _candidates(tree, include_main)
    pos = {k: 0 for k in _ORDER}
    out = []
    seen = set()
    while len(out) < max_n and any(pos[k] < len(cands[k]) for k in _ORDER):
        for k in _ORDER:
            if len(out) >= max_n:
                break
            if pos[k] >= len(cands[k]):
                continue
            i, arg, line, desc = cands[k][pos[k]]
            pos[k] += 1
            code = _apply(tree, i, arg)
            if code == base or code in seen:
                continue
            seen.add(code)
            out.append({'id': '%s-%d-%d' % (k, line, len(out) + 1), 'line': line, 'desc': desc, 'code': code})
    return json.dumps(out, ensure_ascii=False)
`;
