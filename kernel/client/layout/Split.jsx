// <Split ratio="3:2" stackAt={900} stack="auto" gap>：两栏；宽于 stackAt 时左右（各块内部滚动），窄于时上下：
//   stack="auto"（缺省）两块各按内容高，Split 自身纵向滚动（课前页、题目 + 作答）
//   stack="ratio" 上下按 ratio 分高度，各块内部滚动（代码 + 输出这类要一屏放下的）
// single：只渲染第一块、单列占满（同一个网格容器，只改列与行）——在单列与两栏之间切换时第一块不重新挂载
import { Children } from 'react';
import { useMediaQuery } from './useNarrow.js';
import { pickProps, cx, gapOf } from './props.js';

function parseRatio(ratio) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(ratio ?? ''));
  return m ? [m[1], m[2]] : ['1', '1'];
}

const cellBase = {
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

export default function Split({ ratio = '1:1', stackAt = 900, stack = 'auto', single = false, gap, children, ...rest }) {
  const p = pickProps(rest, 'Split');
  const at = Number.isFinite(Number(stackAt)) ? Number(stackAt) : 900;
  const stacked = useMediaQuery(`(max-width: ${at - 1}px)`);
  const byRatio = stack === 'ratio';
  const [a, b] = parseRatio(ratio);
  const tracks = `minmax(0, ${a}fr) minmax(0, ${b}fr)`;
  const all = Children.toArray(children);
  const items = single ? all.slice(0, 1) : all;
  const autoStack = stacked && !byRatio && !single;
  let rows = 'minmax(0, 1fr)';
  if (stacked && !single) rows = byRatio ? tracks : 'auto auto';
  let columns = stacked ? 'minmax(0, 1fr)' : tracks;
  if (single) columns = 'minmax(0, 1fr)';
  return (
    <div
      {...p}
      className={cx('ly-split', p.className)}
      data-ly="split"
      data-direction={stacked ? 'column' : 'row'}
      data-stack={byRatio ? 'ratio' : 'auto'}
      data-single={single ? 'true' : undefined}
      style={{
        display: 'grid',
        flex: '1 1 auto',
        minHeight: 0,
        minWidth: 0,
        gap: gapOf(gap),
        gridTemplateColumns: columns,
        gridTemplateRows: rows,
        alignContent: autoStack ? 'start' : undefined,
        overflowY: autoStack ? 'auto' : undefined,
      }}
    >
      {items.map((child, i) => (
        <div key={child.key ?? i} data-ly="split-cell" style={{ ...cellBase, overflow: autoStack ? 'visible' : 'auto' }}>{child}</div>
      ))}
    </div>
  );
}
