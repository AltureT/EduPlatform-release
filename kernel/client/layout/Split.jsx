// <Split ratio="3:2" stackAt={900} stack="auto" gap resizable storageKey>：两栏；宽于 stackAt 时左右（各块内部滚动），窄于时上下：
//   stack="auto"（缺省）两块各按内容高，Split 自身纵向滚动（课前页、题目 + 作答）
//   stack="ratio" 上下按 ratio 分高度，各块内部滚动（代码 + 输出这类要一屏放下的）
// single：只渲染第一块、单列占满（同一个网格容器，只改列与行）——在单列与两栏之间切换时第一块不重新挂载
// P5（代码段布局与回看规格 §3）resizable：宽屏两栏时在两块之间放一条分隔柱（role="separator"），可拖宽：
//   列 = minmax(0, Afr) <柱宽 = gapOf(gap)> minmax(0, Bfr)，此时 gap 置 0（柱就是原来的空隙）；
//   pointer 拖动（setPointerCapture，触屏可用），两侧各不小于 15%；← → 各 2%，Home / End 到 15% / 85%；双击恢复 ratio。
//   storageKey：比例记到 localStorage['ly-split:' + storageKey]（"a:b"，两个百分数整数），没给只在内存里记；
//   ratio / storageKey 变化时重读记录，没有记录就跟随新 ratio。stacked / single 时不渲染分隔柱
import { Children, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from './useNarrow.js';
import { pickProps, cx, gapOf } from './props.js';

function parseRatio(ratio) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(ratio ?? ''));
  return m ? [m[1], m[2]] : ['1', '1'];
}

export const SPLIT_MIN_PCT = 15;
const MAX_PCT = 100 - SPLIT_MIN_PCT;
const KEY_STEP = 2;
const STORE_PREFIX = 'ly-split:';

const clampPct = (n) => Math.min(MAX_PCT, Math.max(SPLIT_MIN_PCT, Math.round(n)));

function readPct(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = globalThis.localStorage?.getItem(STORE_PREFIX + storageKey);
    const m = /^(\d{1,3}):(\d{1,3})$/.exec(String(raw ?? ''));
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a + b <= 0) return null;
    return clampPct((a / (a + b)) * 100);
  } catch (_) {
    return null;
  }
}
function writePct(storageKey, pct) {
  if (!storageKey) return;
  try {
    globalThis.localStorage?.setItem(STORE_PREFIX + storageKey, `${pct}:${100 - pct}`);
  } catch (_) {
    // 隐私模式等：只在内存里记
  }
}
function clearPct(storageKey) {
  if (!storageKey) return;
  try {
    globalThis.localStorage?.removeItem(STORE_PREFIX + storageKey);
  } catch (_) {
    // 忽略
  }
}

const cellBase = {
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

// 分隔柱：整条柱都能拖（柱宽 = 原来的空隙），中间一条 2px 的线；悬停 / 拖动 / 聚焦时加深
function Gutter({ pct, onDrag, onCommit, onReset, containerRef }) {
  const [hot, setHot] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);   // { rect, pct }
  const pctRef = useRef(pct);
  pctRef.current = pct;

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const el = containerRef.current;
    const rect = el ? el.getBoundingClientRect() : null;
    if (!rect || !(rect.width > 0)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch (_) {
      // 拿不到 pointer（合成事件等）：照常按 move / up 处理
    }
    // 换算时扣掉柱宽：指针落在柱中心时两侧比例正好对应（不扣会差几像素）
    const gw = e.currentTarget?.getBoundingClientRect?.().width || 0;
    drag.current = { rect, gw, pct: pctRef.current, moved: false };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const usable = Math.max(1, d.rect.width - d.gw);
    const next = clampPct(((e.clientX - d.rect.left - d.gw / 2) / usable) * 100);
    if (next === d.pct) return;
    d.pct = next;
    d.moved = true;
    onDrag(next);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    // 只点了一下没拖：不落盘（否则这一键从此不再跟随 ratio）
    if (d.moved) onCommit(d.pct);
  };
  const onKeyDown = (e) => {
    let next = null;
    if (e.key === 'ArrowLeft') next = pctRef.current - KEY_STEP;
    else if (e.key === 'ArrowRight') next = pctRef.current + KEY_STEP;
    else if (e.key === 'Home') next = SPLIT_MIN_PCT;
    else if (e.key === 'End') next = MAX_PCT;
    if (next == null) return;
    e.preventDefault();
    onCommit(clampPct(next));
  };
  const strong = hot || focused || dragging;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={pct}
      aria-valuemin={SPLIT_MIN_PCT}
      aria-valuemax={MAX_PCT}
      aria-label="拖动调整两栏宽度"
      tabIndex={0}
      data-ly="split-gutter"
      data-dragging={dragging ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      style={{
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        justifyContent: 'center',
        cursor: 'col-resize',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div data-ly="split-gutter-line" style={{ width: 2, borderRadius: 1, background: strong ? 'var(--border-strong)' : 'var(--border)' }} />
    </div>
  );
}

export default function Split({
  ratio = '1:1', stackAt = 900, stack = 'auto', single = false, gap, resizable = false, storageKey, children, ...rest
}) {
  const p = pickProps(rest, 'Split');
  const at = Number.isFinite(Number(stackAt)) ? Number(stackAt) : 900;
  const stacked = useMediaQuery(`(max-width: ${at - 1}px)`);
  const byRatio = stack === 'ratio';
  const [a, b] = parseRatio(ratio);
  const key = typeof storageKey === 'string' && storageKey ? storageKey : null;

  // 拖过的比例（A 的百分数）；null = 按 ratio。首次从 storage 读；ratio / key 变化时重读（没有记录就跟随新 ratio）
  const [pct, setPct] = useState(() => (resizable ? readPct(key) : null));
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setPct(resizable ? readPct(key) : null);
  }, [ratio, key, resizable]);
  const containerRef = useRef(null);

  const all = Children.toArray(children);
  const items = single ? all.slice(0, 1) : all;
  const withGutter = resizable && !stacked && !single && items.length === 2;
  const tracks = `minmax(0, ${a}fr) minmax(0, ${b}fr)`;
  const autoStack = stacked && !byRatio && !single;
  let rows = 'minmax(0, 1fr)';
  if (stacked && !single) rows = byRatio ? tracks : 'auto auto';
  let columns = stacked ? 'minmax(0, 1fr)' : tracks;
  if (single) columns = 'minmax(0, 1fr)';
  if (withGutter) {
    const [ca, cb] = pct == null ? [a, b] : [pct, 100 - pct];
    columns = `minmax(0, ${ca}fr) ${gapOf(gap)} minmax(0, ${cb}fr)`;
  }
  const ratioPct = clampPct((Number(a) / ((Number(a) + Number(b)) || 1)) * 100);

  const cells = items.map((child, i) => (
    <div key={child.key ?? i} data-ly="split-cell" style={{ ...cellBase, overflow: autoStack ? 'visible' : 'auto' }}>{child}</div>
  ));
  if (withGutter) {
    cells.splice(1, 0, (
      <Gutter
        key="split-gutter"
        pct={pct ?? ratioPct}
        containerRef={containerRef}
        onDrag={setPct}
        onCommit={(n) => {
          setPct(n);
          writePct(key, n);
        }}
        onReset={() => {
          setPct(null);
          clearPct(key);
        }}
      />
    ));
  }

  return (
    <div
      {...p}
      ref={containerRef}
      className={cx('ly-split', p.className)}
      data-ly="split"
      data-direction={stacked ? 'column' : 'row'}
      data-stack={byRatio ? 'ratio' : 'auto'}
      data-single={single ? 'true' : undefined}
      data-resizable={withGutter ? 'true' : undefined}
      style={{
        display: 'grid',
        flex: '1 1 auto',
        minHeight: 0,
        minWidth: 0,
        gap: withGutter ? 0 : gapOf(gap),
        gridTemplateColumns: columns,
        gridTemplateRows: rows,
        alignContent: autoStack ? 'start' : undefined,
        overflowY: autoStack ? 'auto' : undefined,
      }}
    >
      {cells}
    </div>
  );
}
