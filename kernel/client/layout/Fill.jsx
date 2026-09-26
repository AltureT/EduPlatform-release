// <Fill scroll>：占满父级剩余高度（flex: 1; min-height: 0; 纵向 flex）；scroll 时内部滚动
// U4：挂载时向所在的 focus 面板登记（FillProbeContext），面板据此决定按内容高还是撑满
import { useContext, useLayoutEffect } from 'react';
import { pickProps, cx } from './props.js';
import { FillProbeContext } from './pageContext.js';

export default function Fill({ scroll = false, children, ...rest }) {
  const p = pickProps(rest, 'Fill');
  const probe = useContext(FillProbeContext);
  useLayoutEffect(() => (probe ? probe() : undefined), [probe]);
  return (
    <div
      {...p}
      className={cx('ly-fill', p.className)}
      data-ly="fill"
      style={{
        flex: '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: scroll ? 'auto' : undefined,
      }}
    >
      {children}
    </div>
  );
}
