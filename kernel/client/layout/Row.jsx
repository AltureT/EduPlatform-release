// <Row gap align wrap>：横向排列；缺省自动换行、居中对齐
import { pickProps, cx, gapOf } from './props.js';

const ALIGN = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline' };

export default function Row({ gap, align = 'center', wrap = true, children, ...rest }) {
  const p = pickProps(rest, 'Row');
  return (
    <div
      {...p}
      className={cx('ly-row', p.className)}
      data-ly="row"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: wrap ? 'wrap' : 'nowrap',
        alignItems: ALIGN[align] || 'center',
        gap: gapOf(gap, 'var(--sp-3)'),
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}
