// sandbox 初始化脚本（规格 §3.8）：Worker init 时写入 site-packages/_sandbox_rt.py 再 import，
// 这样运行时自己的帧路径含 /lib/python3，会被 friendlyError 裁掉（学生代码的帧是 <exec>）。
// 依赖 JS 侧 registerJsModule('_sb_js', { flush })：把 Worker 里合批的输出立即送出。
// 与 JS 交换的数据一律是 JSON 字符串（避免 PyProxy 泄漏）。
export default String.raw`
import sys, os, io, json, base64, time, importlib, shutil

sys.dont_write_bytecode = True
os.environ['MPLBACKEND'] = 'Agg'

import _sb_js

STATE = {'ns': None, 'client': None}
FONT_DIR = '/usr/share/fonts/sandbox'
REDIRECT_CODES = (301, 302, 303, 307, 308)
LOCAL_HOSTS = ('websim.invalid', 'localhost', '127.0.0.1')
VALUE_MAX = 10000


def flush():
    for s in (sys.stdout, sys.stderr):
        try:
            s.flush()
        except Exception:
            pass
    try:
        _sb_js.flush()
    except Exception:
        pass


# time.sleep：先把已有输出送出再睡（Worker 事件循环在同步运行期间被阻塞，定时器式合批不会触发）
_orig_sleep = time.sleep


def _sleep(secs):
    flush()
    return _orig_sleep(secs)


_sleep.__doc__ = _orig_sleep.__doc__
time.sleep = _sleep


def _err(e):
    import traceback
    msg = (e.msg or '') if isinstance(e, SyntaxError) else str(e)
    return {'type': type(e).__name__, 'message': msg, 'traceback': ''.join(traceback.format_exception(e))}


def run(code):
    """全新命名空间执行学生代码；最后一条是裸表达式时返回其 repr（只求值一次）。成功时记住命名空间供 http() 使用"""
    from pyodide.code import eval_code
    ns = {'__name__': '__main__'}
    try:
        try:
            value = eval_code(code, ns, return_mode='last_expr')
        except SystemExit as e:
            if e.code not in (None, 0):
                raise
            value = None
        text = None
        if value is not None:
            try:
                text = repr(value)
            except BaseException as e2:
                text = '<repr 出错：%s>' % type(e2).__name__
            if len(text) > VALUE_MAX:
                text = text[:VALUE_MAX] + '…'
        STATE['ns'] = ns
        STATE['client'] = None
        return json.dumps({'ok': True, 'value': text, 'error': None})
    except BaseException as e:
        return json.dumps({'ok': False, 'value': None, 'error': _err(e)})
    finally:
        del ns
        flush()


def _png(fig, dpi):
    b = io.BytesIO()
    fig.savefig(b, format='png', dpi=dpi, bbox_inches='tight')
    return base64.b64encode(b.getvalue()).decode('ascii')


def collect_figs(limit=80000, max_n=6):
    """收集所有 figure：[(dpi 96 原图, compact)]；原图超 limit 时按 72、50 dpi 重出，仍超则 compact 为 None"""
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return '[]'
    out = []
    try:
        for n in plt.get_fignums()[:max_n]:
            try:
                fig = plt.figure(n)
                full = _png(fig, 96)
                compact = full if len(full) <= limit else None
                if compact is None:
                    for dpi in (72, 50):
                        c = _png(fig, dpi)
                        if len(c) <= limit:
                            compact = c
                            break
                out.append([full, compact])
            except Exception:
                pass
    finally:
        try:
            plt.close('all')
        except Exception:
            pass
    return json.dumps(out)


# K4：常见中文字体名都作别名指向子集字体，学生照大陆常见写法设 SimHei 等也能显示中文、不报 findfont
CJK_FONT_ALIASES = (
    'SimHei', '黑体', 'Microsoft YaHei', '微软雅黑', 'SimSun', '宋体', 'NSimSun', 'KaiTi', '楷体',
    'FangSong', '仿宋', 'DengXian', '等线', 'YouYuan', '幼圆', 'PingFang SC', '苹方', 'Heiti SC',
    'STHeiti', 'STSong', 'STKaiti', 'STFangsong', 'Hiragino Sans GB', 'WenQuanYi Micro Hei',
    'WenQuanYi Zen Hei', 'Source Han Sans SC', 'Source Han Sans CN', 'Noto Sans CJK SC', 'Noto Sans SC',
    'Arial Unicode MS',
)


def _add_font_aliases(font_manager, font_path):
    fm = font_manager.fontManager
    base = next((f for f in fm.ttflist if f.fname == font_path), None)
    if base is None:
        return
    have = {f.name for f in fm.ttflist}
    for alias in CJK_FONT_ALIASES:
        if alias in have:
            continue
        fm.ttflist.append(font_manager.FontEntry(
            fname=base.fname, name=alias, style=base.style, variant=base.variant,
            weight=base.weight, stretch=base.stretch, size=base.size))
    cached = getattr(fm, '_findfont_cached', None)
    if cached is not None and hasattr(cached, 'cache_clear'):
        cached.cache_clear()


def setup_mpl(font_path):
    """matplotlib 加载后调用：Agg、注册中文字体、关掉负号 unicode、plt.show 变空操作"""
    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import font_manager
    import matplotlib.pyplot as plt
    names = []
    if font_path and os.path.exists(font_path):
        try:
            font_manager.fontManager.addfont(font_path)
            names.append(font_manager.FontProperties(fname=font_path).get_name())
            _add_font_aliases(font_manager, font_path)
        except Exception:
            pass
    rc = matplotlib.rcParams
    rc['font.sans-serif'] = names + ['Noto Sans CJK SC', 'Noto Sans SC'] + [f for f in rc['font.sans-serif'] if f not in names]
    rc['font.family'] = 'sans-serif'
    rc['axes.unicode_minus'] = False
    plt.show = lambda *a, **k: None
    return json.dumps(names)


def patch_flask():
    import flask
    from flask.json.provider import DefaultJSONProvider
    DefaultJSONProvider.ensure_ascii = False

    def _run(self, *a, **k):
        print('模拟环境里不需要 app.run()，直接用上方的模拟浏览器访问')

    flask.Flask.run = _run


def _check_path(p):
    if not isinstance(p, str) or p == '' or p.startswith('/') or '\\' in p:
        raise ValueError('bad path: %r' % (p,))
    for seg in p.split('/'):
        if seg in ('', '.', '..'):
            raise ValueError('bad path: %r' % (p,))


def write_files(files_json):
    files = json.loads(files_json)
    for p in files:
        _check_path(p)
    for p, content in files.items():
        d = os.path.dirname(p)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(content)


def run_tests(code, tests_json):
    """写 main.py 与 tests/<文件>，清模块缓存后跑 pytest，返回 junit xml（失败为空串）"""
    tests = json.loads(tests_json)
    for name in tests:
        _check_path(name)
    with open('main.py', 'w', encoding='utf-8') as f:
        f.write(code)
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
    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)
    junit = '/tmp/junit.xml'
    try:
        os.remove(junit)
    except OSError:
        pass
    import pytest
    try:
        pytest.main(['-q', '-p', 'no:cacheprovider', '--junitxml=' + junit, 'tests'])
    finally:
        flush()
    try:
        with open(junit, encoding='utf-8') as f:
            return f.read()
    except OSError:
        return ''


def _is_text(mimetype):
    return (mimetype.startswith('text/') or mimetype in ('application/json', 'application/javascript', 'application/xml')
            or mimetype.endswith('+json') or mimetype.endswith('+xml'))


def http(req_json):
    """把请求交给最近一次成功运行的命名空间里的 Flask app（test_client，逐跳跟随重定向 ≤ 5）"""
    from urllib.parse import urlsplit, urljoin, urlencode
    req = json.loads(req_json)
    ns = STATE['ns']
    flask = sys.modules.get('flask')
    app = ns.get('app') if ns is not None else None
    if flask is None or app is None or not isinstance(app, flask.Flask):
        return json.dumps({'noApp': True})
    client = STATE['client']
    if client is None:
        client = app.test_client()
        STATE['client'] = client
    method = str(req.get('method') or 'GET').upper()
    path = str(req.get('path') or '/')
    body = req.get('body')
    headers = req.get('headers') or {}
    redirects = 0
    try:
        while True:
            kw = {'method': method, 'headers': headers, 'follow_redirects': False}
            if isinstance(body, dict):
                if method in ('GET', 'HEAD'):
                    q = urlencode(body, doseq=True)
                    if q:
                        path = path + ('&' if '?' in path else '?') + q
                else:
                    kw['data'] = body
                    kw['content_type'] = 'application/x-www-form-urlencoded'
            elif isinstance(body, str) and body != '' and method not in ('GET', 'HEAD'):
                kw['data'] = body.encode('utf-8')
            body_sent = body
            resp = client.open(path, **kw)
            loc = resp.headers.get('Location')
            if resp.status_code in REDIRECT_CODES and loc and redirects < 5:
                parts = urlsplit(urljoin('http://websim.invalid' + path, loc))
                if parts.hostname not in LOCAL_HOSTS:
                    break
                nxt = parts.path or '/'
                if parts.query:
                    nxt += '?' + parts.query
                if resp.status_code == 303 or (resp.status_code in (301, 302) and method not in ('GET', 'HEAD')):
                    method = 'GET'
                    body = None
                elif isinstance(body_sent, dict) and method in ('GET', 'HEAD'):
                    body = None
                path = nxt
                redirects += 1
                continue
            break
    except Exception as e:
        import traceback
        text = ''.join(traceback.format_exception(e))
        ctype = 'text/plain; charset=utf-8'
        return json.dumps({'status': 500, 'headers': {'Content-Type': ctype}, 'contentType': ctype, 'body': text,
                           'binary': False, 'finalPath': path, 'redirects': redirects})
    finally:
        flush()
    mimetype = resp.mimetype or ''
    data = resp.get_data()
    binary = not _is_text(mimetype)
    text = base64.b64encode(data).decode('ascii') if binary else data.decode('utf-8', errors='replace')
    out_headers = {}
    for k, v in resp.headers.items():
        out_headers[k] = out_headers[k] + ', ' + v if k in out_headers else v
    return json.dumps({'status': resp.status_code, 'headers': out_headers, 'contentType': resp.content_type or '',
                       'body': text, 'binary': binary, 'finalPath': path, 'redirects': redirects})
`;
