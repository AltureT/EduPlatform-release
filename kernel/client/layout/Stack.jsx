// <Stack gap>：纵向排列，gap 用间距令牌
import { pickProps, cx, gapOf } from './props.js';

export default function Stack({ gap, children, ...rest }) {
  const p = pickProps(rest, 'Stack');
  return (
    <div
      {...p}
      className={cx('ly-stack', p.className)}
      data-ly="stack"
      style={{ display: 'flex', flexDirection: 'column', gap: gapOf(gap), minWidth: 0 }}
    >
      {children}
    </div>
  );
}
