// <Tiles min="260px" gap>：repeat(auto-fit, minmax(var(--tile-min, 260px), 1fr))
import { pickProps, cx, gapOf } from './props.js';

export default function Tiles({ min, gap, children, ...rest }) {
  const p = pickProps(rest, 'Tiles');
  const style = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(var(--tile-min, 260px), 1fr))',
    alignContent: 'start',
    gap: gapOf(gap),
    minWidth: 0,
  };
  if (min != null && min !== '') style['--tile-min'] = typeof min === 'number' ? `${min}px` : String(min);
  return (
    <div {...p} className={cx('ly-tiles', p.className)} data-ly="tiles" style={style}>
      {children}
    </div>
  );
}
