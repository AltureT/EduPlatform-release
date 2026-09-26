// <PyRunner>（规格 §3.4）：编辑器 + 按钮行 + 状态芯片 + 输出区
// - 只读：useStudentStage(stageId).readOnly（镜像内）时只显示 myData（草稿比提交新则显示草稿），不渲染按钮、不调 ensure
// - 刷新保留：学生端按 sandbox:<lessonId>:<classEpoch>:<name>:<stageId> 防抖 1 s 写 localStorage；教师端不写
// - 挂载时 ensure(本阶段包, { flask }) → writeFiles(files)；状态上报由 studentOverlay 负责，这里不发 s-status；卸载不销毁 Worker
// - draftEvent：运行 / 测试结束后与代码停止变化 5 s 后，用 buildRecord(…, { draft:true }) 发该事件（≥ 5 s 一次）
// - S3：本实例运行次数（run + test，挂载时从 0 起）经 onResult / onTest 的第二参数 { runs } 交给阶段，草稿也用它；
//   onRestore({ code, result })：挂载时从 localStorage 恢复到带运行时代码的最近结果就回调一次（code 为那次运行时的代码，result 见 resultOfLast）
// - P3：测试结果先经 enrichCases 给每个用例加 label（docstring 优先）/ reason（失败原因）再显示与交给 onTest；
//   编辑器与输出区各有一行小标题（代码 / 输出，测试后输出区为"测试结果"），captions={false} 关掉
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudentStage, useComponent, registerKernelHook, Btn, Chip, Fill, Split, Row } from '#kernel/client/index.js';
import { usePython } from '../usePython.js';
import { getPythonClient } from '../pythonClient.js';
import { useSandboxConfig } from '../stageConfig.js';
import { buildRecord } from '../buildRecord.js';
import { isUnsupportedError } from '../compat.js';
import Editor from './Editor.jsx';
import { MONO } from './mono.js';
import PyOutput from './PyOutput.jsx';
import { enrichCases } from './testReport.js';
import { draftKey, readDraft, writeDraft, clearLessonDrafts, lastOfRun, lastOfTest, resultOfLast } from './draftStorage.js';

const EMPTY = Object.freeze({});
const SAVE_MS = 1000;
const DRAFT_GAP_MS = 5000;
const DRAFT_IDLE_MS = 5000;
const MAX_CHARS = 200 * 1024;
const TEXT_KINDS = new Set(['stdout', 'stderr', 'system']);

const raf = (fn) => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));
const cancelRaf = (h) => (typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame(h) : clearTimeout(h));

// 追加条目：相邻同类文本合并；总字符数超上限时从头裁
export function mergeEntries(prev, add) {
  const out = prev.slice();
  for (const e of add) {
    const l = out[out.length - 1];
    if (l && TEXT_KINDS.has(e.kind) && l.kind === e.kind) out[out.length - 1] = { ...l, text: l.text + e.text };
    else out.push(e);
  }
  let total = out.reduce((n, e) => n + (typeof e.text === 'string' ? e.text.length : 0), 0);
  while (total > MAX_CHARS && out.length > 0) {
    const f = out[0];
    const len = typeof f.text === 'string' ? f.text.length : 0;
    if (len > total - MAX_CHARS) {
      const cut = total - MAX_CHARS;
      out[0] = { ...f, text: f.text.slice(cut) };
      total -= cut;
    } else {
      out.shift();
      total -= len;
    }
  }
  return out;
}

function entriesOfLast(last) {
  const out = [];
  if (!last) return out;
  if (last.stdout) out.push({ kind: 'stdout', text: last.stdout });
  if (last.interrupted && !last.error) out.push({ kind: 'system', text: '已停止\n' });
  if (last.error) out.push({ kind: 'error', error: last.error });
  for (const png of last.images ?? []) if (typeof png === 'string' && png) out.push({ kind: 'image', png });
  return out;
}

function opErrorText(e) {
  const m = String(e?.message ?? e);
  if (m === 'busy') return '正在运行，稍后再试';
  if (m === 'failed') return '运行环境没有加载成功';
  if (m === 'restarted') return '运行环境已重启，请再运行一次';
  return m;
}

function chipOf(snap, elapsed) {
  switch (snap.status) {
    case 'loading':
      return snap.progress?.phase === 'restart'
        ? ['重启中', 'accent']
        : [`加载中${snap.progress?.detail ? ` · ${snap.progress.detail}` : ''}`, 'accent'];
    case 'ready': return ['就绪', 'good'];
    case 'running': return [`运行中 ${(elapsed / 1000).toFixed(1)} s`, 'brand'];
    case 'waiting-input': return ['等待输入', 'warn'];
    case 'failed': return ['加载失败', 'bad'];
    default: return ['未加载', 'neutral'];
  }
}

// 布局（界面整理规格 §3、§5）：<Fill> 撑满父级 → <Split ratio="3:2" stack="ratio">（wide 左右、narrow 上下按 3:2 分高）
// 左 / 上编辑器，右 / 下输出（<Fill scroll> 内部滚动）；工具栏 <Row> 在下方。只读态同样撑满，没有工具栏
// P3：captions 时两块各在上方加一行小标题（--fs-sm、--ink-dim）
const captionStyle = { flexShrink: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-dim)', fontWeight: 600, lineHeight: 1.4, paddingBottom: 'var(--sp-1)' };
function Caption({ children }) {
  return <div data-sandbox-caption="" style={captionStyle}>{children}</div>;
}

function Frame({ editor, output, controls, captions = true, outputCaption = '输出' }) {
  return (
    <Fill data-sandbox-runner="">
      <Split ratio="3:2" stack="ratio">
        {captions ? <Fill><Caption>代码</Caption>{editor}</Fill> : editor}
        {captions
          ? <Fill><Caption>{outputCaption}</Caption><Fill scroll>{output}</Fill></Fill>
          : <Fill scroll>{output}</Fill>}
      </Split>
      {controls}
    </Fill>
  );
}

const outputFill = { flex: '1 0 auto' };

// ---------- 只读 ----------

function ReadOnlyRunner({ myData, captions }) {
  const useDraft = !!(myData?.draft && myData.draft.at > (myData.submittedAt ?? 0));
  const rec = useDraft ? myData.draft : myData;
  const label = rec ? (useDraft ? '草稿' : '已提交') : undefined;
  return (
    <Frame
      captions={captions}
      outputCaption={rec?.tests ? '测试结果' : '输出'}
      editor={<Editor value={rec?.code ?? ''} readOnly />}
      controls={null}
      output={<PyOutput record={rec} label={label} hideCode style={outputFill} />}
    />
  );
}

// ---------- input() 输入行 ----------

function InputLine({ prompt, onSend }) {
  const [v, setV] = useState('');
  const send = () => {
    onSend(v);
    setV('');
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle', maxWidth: '100%' }}>
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        aria-label={prompt || '输入'}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent?.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          send();
        }}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        style={{
          fontFamily: MONO,
          fontSize: '16px',
          minWidth: 0,
          width: '14em',
          padding: '2px 6px',
          color: 'var(--ink)',
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
        }}
      />
      <Btn size="sm" variant="primary" onClick={send}>发送</Btn>
    </span>
  );
}

// ---------- 可编辑 ----------

function LiveRunner({ st, stageId, code: codeProp, onChange, draftEvent, onResult, onTest, onRestore, extraButtons, extraCompletions, captions = true }) {
  const c = useComponent('sandbox');
  const py = usePython();
  const client = getPythonClient();
  const sb = useSandboxConfig(stageId) ?? EMPTY;
  const hasTests = !!(sb.tests && Object.keys(sb.tests).length > 0);
  const isStudent = c.role === 'student';
  const lessonId = c.lesson?.id ?? null;
  const key = isStudent ? draftKey({ lessonId, classEpoch: c.classEpoch, name: c.me?.name, stageId }) : null;

  // 挂载时读一次草稿（键变化时重读）
  const saved = useMemo(() => readDraft(key), [key]);
  const controlled = codeProp !== undefined;
  const [inner, setInner] = useState(() => (typeof saved?.code === 'string' ? saved.code : sb.starter ?? ''));
  const code = controlled ? String(codeProp ?? '') : inner;
  const setCode = (v) => {
    if (!controlled) setInner(v);
    onChange?.(v);
  };

  const [entries, setEntries] = useState(() => entriesOfLast(saved?.last));
  const [test, setTest] = useState(() => saved?.last?.tests ?? null);
  const [owner, setOwner] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [retryN, setRetryN] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const editorRef = useRef(null);
  const ownRef = useRef(false);
  const codeRef = useRef(code);
  codeRef.current = code;
  const lastRef = useRef(saved?.last ?? null);
  const lastResultRef = useRef(saved?.last ? { stdout: saved.last.stdout, error: saved.last.error, imagesCompact: [], ms: 0 } : null);
  const lastTestRef = useRef(saved?.last?.tests ?? null);
  const disabledRef = useRef(false);   // classroom:reset 之后不再写
  const runsRef = useRef(0);   // S3：本实例运行次数（run + test）

  // ---------- 受控模式下的刷新恢复：挂载时把草稿交给阶段 ----------
  useEffect(() => {
    if (controlled && typeof saved?.code === 'string' && saved.code !== codeProp) onChange?.(saved.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- S3：刷新恢复到最近结果时交给阶段（提交按钮可按恢复的结果启用） ----------
  useEffect(() => {
    const result = resultOfLast(saved?.last);
    // 旧版保存的最近结果没有运行时的代码：不知道配哪份代码，不回调（否则会和之后改过的代码配对，误启用提交）
    if (!result || typeof onRestore !== 'function' || typeof saved.last.code !== 'string') return;
    const code = saved.last.code;
    try {
      onRestore({ code, result });
    } catch (e) {
      console.warn('[sandbox] onRestore 出错', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- ensure → writeFiles ----------
  useEffect(() => {
    client
      .ensure(Array.isArray(sb.packages) ? sb.packages : [], { flask: !!sb.flask })
      .then(() => (sb.files && Object.keys(sb.files).length > 0 ? client.writeFiles(sb.files) : undefined))
      .catch(() => {});
  }, [client, sb, retryN]);

  // ---------- localStorage（防抖 1 s；卸载时立即写） ----------
  const saveTimer = useRef(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (disabledRef.current || !keyRef.current) return;
    writeDraft(keyRef.current, { code: codeRef.current, last: lastRef.current });
  }, []);
  const scheduleSave = useCallback(() => {
    if (!keyRef.current || disabledRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, SAVE_MS);
  }, [saveNow]);
  useEffect(() => () => {
    if (saveTimer.current) saveNow();
  }, [saveNow]);

  useEffect(() => {
    if (!isStudent || !lessonId) return undefined;
    return registerKernelHook('reset', () => {
      disabledRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      clearLessonDrafts(lessonId);
    });
  }, [isStudent, lessonId]);

  // ---------- 草稿事件（≥ 5 s 一次） ----------
  const draft = useRef({ lastAt: -Infinity, timer: null, idle: null, json: null });
  const sendRef = useRef(st.send);
  sendRef.current = st.send;
  const sendDraft = useCallback(() => {
    const d = draft.current;
    d.timer = null;
    if (disabledRef.current) return;
    const rec = buildRecord(lastResultRef.current, {
      code: codeRef.current, tests: lastTestRef.current, runs: runsRef.current, draft: true,
    });
    const json = JSON.stringify(rec);
    if (json === d.json) return;
    d.json = json;
    d.lastAt = Date.now();
    try {
      sendRef.current(draftEvent, rec);
    } catch (e) {
      console.warn('[sandbox] draftEvent 发送失败', e);
    }
  }, [draftEvent]);
  const requestDraft = useCallback(() => {
    if (!draftEvent || !isStudent) return;
    const d = draft.current;
    if (d.timer) return;
    const wait = d.lastAt + DRAFT_GAP_MS - Date.now();
    if (wait <= 0) sendDraft();
    else d.timer = setTimeout(sendDraft, wait);
  }, [draftEvent, isStudent, sendDraft]);
  useEffect(() => () => {
    clearTimeout(draft.current.timer);
    clearTimeout(draft.current.idle);
  }, []);

  // 代码变化：写 localStorage（防抖）、停 5 s 后发草稿
  const firstCode = useRef(true);
  useEffect(() => {
    if (firstCode.current) {
      firstCode.current = false;
      return;
    }
    scheduleSave();
    if (draftEvent && isStudent) {
      clearTimeout(draft.current.idle);
      draft.current.idle = setTimeout(requestDraft, DRAFT_IDLE_MS);
    }
  }, [code, scheduleSave, draftEvent, isStudent, requestDraft]);

  // ---------- 输出（rAF 合批） ----------
  const buf = useRef([]);
  const rafH = useRef(null);
  const flush = useCallback(() => {
    if (rafH.current != null) cancelRaf(rafH.current);
    rafH.current = null;
    const add = buf.current;
    buf.current = [];
    if (add.length > 0) setEntries((prev) => mergeEntries(prev, add));
  }, []);
  const push = useCallback((e) => {
    buf.current.push(e);
    if (rafH.current == null) rafH.current = raf(flush);
  }, [flush]);
  useEffect(() => () => {
    if (rafH.current != null) cancelRaf(rafH.current);
  }, []);
  const clearOutput = () => {
    if (rafH.current != null) cancelRaf(rafH.current);
    rafH.current = null;
    buf.current = [];
    setEntries([]);
    setTest(null);
  };
  const appendNow = (list) => {
    buf.current.push(...list);
    flush();
  };

  // ---------- input()：只在发起本次运行的实例里显示 ----------
  useEffect(() => client.subscribe((ev) => {
    if (ev?.type === 'stdin-request' && ownRef.current) setPrompt(ev.prompt ?? '');
  }), [client]);

  // ---------- 运行计时 ----------
  const busy = py.status === 'running' || py.status === 'waiting-input';
  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => clearInterval(t);
  }, [busy]);

  const begin = () => {
    clearOutput();
    ownRef.current = true;
    setOwner(true);
    setPrompt('');
  };
  const end = () => {
    ownRef.current = false;
    setOwner(false);
    setPrompt('');
  };

  const onRun = async () => {
    const src = codeRef.current;
    begin();
    let r;
    try {
      r = await client.run(src, {
        onOutput: (o) => push({ kind: o.kind, text: String(o.text ?? '') }),
        onImage: (png) => push({ kind: 'image', png }),
      });
    } catch (e) {
      end();
      appendNow([{ kind: 'system', text: `${opErrorText(e)}\n` }]);
      return;
    }
    end();
    runsRef.current += 1;
    const tail = [];
    if (r.interrupted && !r.error) tail.push({ kind: 'system', text: '已停止\n' });
    if (r.error) tail.push({ kind: 'error', error: r.error });
    if (r.value != null) tail.push({ kind: 'value', text: String(r.value) });
    if (Array.isArray(r.images) && r.images.length > 0 && typeof r.imagesCompact?.[0] !== 'string') {
      tail.push({ kind: 'system', text: '图片过大，未随记录保存\n' });
    }
    appendNow(tail);
    lastResultRef.current = r;
    lastRef.current = { ...lastOfRun(r), code: src };
    scheduleSave();
    try {
      onResult?.(r, { runs: runsRef.current });
    } finally {
      requestDraft();
    }
  };

  const onTestClick = async () => {
    const src = codeRef.current;
    begin();
    let t;
    try {
      t = enrichCases(await client.test(src, sb.tests, { onOutput: (o) => push({ kind: o.kind, text: String(o.text ?? '') }) }), sb.tests);
    } catch (e) {
      end();
      appendNow([{ kind: 'system', text: `${opErrorText(e)}\n` }]);
      return;
    }
    end();
    runsRef.current += 1;
    if (t.interrupted) appendNow([{ kind: 'system', text: '已停止\n' }]);
    else flush();
    if (!t.interrupted) {
      setTest(t);
      lastTestRef.current = t;
      lastRef.current = { ...lastOfTest(t), code: src };
      scheduleSave();
    }
    try {
      onTest?.(t, { runs: runsRef.current });
    } finally {
      requestDraft();
    }
  };

  const onSendInput = (line) => {
    push({ kind: 'stdout', text: `${line}\n` });
    client.sendInput(line).catch(() => {});
  };

  const retry = () => setRetryN((n) => n + 1);

  const snap = { status: py.status, progress: py.progress };
  const [chipText, chipTone] = chipOf(snap, elapsed);
  const ready = py.status === 'ready';
  const showInput = owner && py.status === 'waiting-input';

  // 缩进按钮按下时不抢焦点：焦点留在编辑器（平板软键盘不收起）
  const keepFocus = (e) => e.preventDefault();
  const controls = (
    <div data-sandbox-toolbar="" style={{ flexShrink: 0, paddingTop: 'var(--sp-3)' }}>
      <Row gap={2}>
        <Btn variant="primary" disabled={!ready} onClick={onRun}>▶ 运行</Btn>
        <Btn variant="ghost" disabled={!busy} onClick={() => client.stop()}>■ 停止</Btn>
        {hasTests && <Btn variant="soft" disabled={!ready} onClick={onTestClick}>🧪 测试</Btn>}
        <Btn variant="soft" aria-label="增加缩进" onMouseDown={keepFocus} onClick={() => editorRef.current?.indentMore()}>→缩进</Btn>
        <Btn variant="soft" aria-label="减少缩进" onMouseDown={keepFocus} onClick={() => editorRef.current?.indentLess()}>←</Btn>
        <Chip tone={chipTone}>{chipText}</Chip>
        {py.status === 'failed' && (
          <>
            <span role="alert" style={{ color: 'var(--bad)', fontSize: 'var(--fs-sm)' }}>{py.error}</span>
            {!isUnsupportedError(py.error) && <Btn variant="accent" onClick={retry}>重试</Btn>}
          </>
        )}
        {py.status !== 'failed' && py.error && (
          <span role="status" style={{ color: 'var(--bad)', fontSize: 'var(--fs-sm)' }}>{py.error}</span>
        )}
        {py.status !== 'idle' && py.status !== 'failed' && (
          <Btn variant="ghost" onClick={() => client.restart()}>⟳ 重启运行环境</Btn>
        )}
        {extraButtons ? <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>{extraButtons}</span> : null}
      </Row>
    </div>
  );

  // Ctrl/Cmd+Enter：就绪时运行（未就绪时吞掉按键，不插空行）
  const runFromKey = () => {
    if (ready) onRun();
  };

  return (
    <Frame
      captions={captions}
      outputCaption={test ? '测试结果' : '输出'}
      editor={<Editor ref={editorRef} value={code} onChange={setCode} onRun={runFromKey} extraCompletions={extraCompletions} />}
      controls={controls}
      output={(
        <PyOutput entries={entries} test={test} style={outputFill}>
          {showInput && <InputLine prompt={prompt} onSend={onSendInput} />}
        </PyOutput>
      )}
    />
  );
}

export default function PyRunner({ stageId, ...rest }) {
  const st = useStudentStage(stageId);
  if (st.readOnly) return <ReadOnlyRunner myData={st.myData} captions={rest.captions !== false} />;
  return <LiveRunner st={st} stageId={stageId} {...rest} />;
}
