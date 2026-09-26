// <PyOutput>（规格 §3.4、§3.6）两种用法：
// - 记录模式 { record, label }：只读渲染 §3.6 形状的记录（代码折叠、stdout、error + hint、image、tests），供镜像与 DetailModal 复用
// - 流式模式 { entries, test, children }：PyRunner 的实时输出区；entries = [{ kind:'stdout'|'stderr'|'system'|'value', text }
//   | { kind:'error', error:{ type, message, traceback, hint } } | { kind:'image', png }]；children 渲染在末尾（input() 输入框）
// P3 测试结果面板（TestPanel）：一行摘要（全过绿色"全部通过 n / n"，否则"通过 x / n"）+ 每个用例一行 ✓ / ✗ 名字（失败带一行原因）。
//   流式模式有 test 时面板在输出区顶部，原文（pytest 输出）收进"查看详细输出 ▾"（缺省收起）；
//   记录模式 tests 同样渲染面板（旧记录没有 cases 只显示摘要），stdout 像 pytest 原文时也收起
import { Chip } from '#kernel/client/index.js';
import { friendlyError } from '../friendlyError.js';
import { MONO } from './mono.js';
import { caseRows } from './testReport.js';

const box = {
  fontFamily: MONO,
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
  color: 'var(--ink)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
};
// 图片按容器宽度缩放（界面整理规格 §5）
const imgStyle = { display: 'block', maxWidth: '100%', height: 'auto', margin: '6px 0', background: 'var(--surface)', borderRadius: 'var(--radius-sm)' };
const COLORS = { stdout: 'var(--ink)', stderr: 'var(--bad)', system: 'var(--ink-dim)', value: 'var(--ink-soft)' };

export function testSummary(t) {
  if (!t) return '';
  return `通过 ${Number(t.passed) || 0} / ${Number(t.total) || 0}`;
}

const allPassed = (t) => {
  const total = Number(t.total) || 0;
  return total > 0 && (Number(t.passed) || 0) === total && !(Number(t.failed) > 0) && !(Number(t.errors) > 0);
};

export function TestPanel({ test }) {
  if (!test) return null;
  const ok = allPassed(test);
  const rows = caseRows(test);
  return (
    <div data-sandbox-tests="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)', fontSize: 'var(--fs-sm)' }}>
      <div data-test-summary="" style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: ok ? 'var(--good)' : 'var(--bad)' }}>
        {ok ? `全部${testSummary(test)}` : testSummary(test)}
      </div>
      {rows.map((c, i) => (
        <div key={`${c.name}-${i}`} data-test-case="" data-ok={c.ok ? 'true' : 'false'} style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline', lineHeight: 1.5 }}>
          <span style={{ flexShrink: 0, fontWeight: 700, color: c.ok ? 'var(--good)' : 'var(--bad)' }}>{c.ok ? '✓' : '✗'}</span>
          <span style={{ minWidth: 0, color: 'var(--ink)' }}>
            <span>{c.name}</span>
            {!c.ok && c.reason && (
              <span style={{ display: 'block', fontFamily: MONO, fontSize: 'var(--fs-sm)', color: 'var(--ink-soft)', wordBreak: 'break-word' }}>{c.reason}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// 原文折叠：summary "查看详细输出 ▾"
function RawFold({ children }) {
  return (
    <details data-test-raw="">
      <summary style={{ cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>查看详细输出 ▾</summary>
      <div style={{ marginTop: 6 }}>{children}</div>
    </details>
  );
}

// 记录里的 stdout 是不是 pytest 原文（测试时没有同一份代码的运行输出，记录带的就是测试输出）
const PYTEST_RE = /(\[\s*\d+%\]\s*$)|(^=+ .+ =+\s*$)|(\b\d+ (passed|failed|errors?)\b.* in [\d.]+s\s*$)/m;
export const looksLikePytest = (s) => typeof s === 'string' && PYTEST_RE.test(s);

function ErrorBlock({ error }) {
  const text = error.traceback || `${error.type}: ${error.message ?? ''}`;
  return (
    <span data-kind="error" style={{ display: 'block', margin: '4px 0' }}>
      <span style={{ ...box, display: 'block', color: 'var(--bad)' }}>{text}</span>
      {error.hint && (
        <span style={{ display: 'block', marginTop: 4, color: 'var(--warn)', fontSize: 'var(--fs-sm)' }}>{error.hint}</span>
      )}
    </span>
  );
}

function Entry({ e }) {
  if (!e) return null;
  if (e.kind === 'image') return <img data-kind="image" alt="" src={`data:image/png;base64,${e.png}`} style={imgStyle} />;
  if (e.kind === 'error') return e.error ? <ErrorBlock error={e.error} /> : null;
  if (e.kind === 'value') return <span data-kind="value" style={{ display: 'block', color: COLORS.value }}>{`=> ${e.text}`}</span>;
  return <span data-kind={e.kind} style={{ color: COLORS[e.kind] ?? COLORS.stdout }}>{e.text}</span>;
}

// "Type: 首行消息" → { type, message }
function splitError(s) {
  const str = String(s ?? '');
  const i = str.indexOf(':');
  return i > 0 ? { type: str.slice(0, i).trim(), message: str.slice(i + 1).trim() } : { type: str.trim(), message: '' };
}

function RecordView({ record, label, hideCode }) {
  const r = record ?? {};
  const code = typeof r.code === 'string' ? r.code : '';
  const err = r.error ? splitError(r.error) : null;
  const hint = err ? friendlyError(err.type, err.message, '').hint : null;
  const img = Array.isArray(r.images) ? r.images.find((x) => typeof x === 'string' && x) : null;
  const stdout = r.stdout ? <pre data-kind="stdout" style={box}>{r.stdout}</pre> : null;
  return (
    <div data-sandbox-record="" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <div><Chip tone="outline">{label}</Chip></div>}
      {!hideCode && code && (
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>
            {`代码 · ${code.split('\n').length} 行`}
          </summary>
          <pre style={{ ...box, marginTop: 6, padding: 8, background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)', overflow: 'auto' }}>{code}</pre>
        </details>
      )}
      {r.tests && <TestPanel test={r.tests} />}
      {stdout && (r.tests && looksLikePytest(r.stdout) ? <RawFold>{stdout}</RawFold> : stdout)}
      {err && <ErrorBlock error={{ type: err.type, message: err.message, traceback: '', hint }} />}
      {img && <img data-kind="image" alt="" src={`data:image/png;base64,${img}`} style={imgStyle} />}
    </div>
  );
}

export default function PyOutput({ record, label, entries, test, hideCode = false, children, style }) {
  const wrap = {
    padding: 10,
    background: 'var(--surface-alt)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    overflow: 'auto',
    minHeight: 0,
    ...style,
  };
  if (!entries) {
    return (
      <div style={wrap}>
        <RecordView record={record} label={label} hideCode={hideCode} />
      </div>
    );
  }
  const raw = (
    <div style={box}>
      {entries.map((e, i) => <Entry key={i} e={e} />)}
      {children}
    </div>
  );
  return (
    <div style={wrap} data-sandbox-output="">
      {test && <TestPanel test={test} />}
      {label && <div style={{ marginBottom: 6 }}><Chip tone="outline">{label}</Chip></div>}
      {test ? <RawFold>{raw}</RawFold> : raw}
    </div>
  );
}
