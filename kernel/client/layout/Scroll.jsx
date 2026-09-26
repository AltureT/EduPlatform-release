// <Scroll>：内部滚动容器（overflow: auto; min-height: 0）
import { pickProps, cx } from './props.js';

export default function Scroll({ children, ...rest }) {
  const p = pickProps(rest, 'Scroll');
  return (
    <div
      {...p}
      className={cx('ly-scroll', p.className)}
      data-ly="scroll"
      style={{ overflow: 'auto', minHeight: 0, minWidth: 0 }}
    >
      {children}
    </div>
  );
}
