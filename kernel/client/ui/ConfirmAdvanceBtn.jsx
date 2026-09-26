// 二次确认按钮：首次点击进入确认态（windowMs 窗口），窗口内再点才触发 onAdvance；超时回默认态。
import { useEffect, useRef, useState } from 'react';
import Btn from './Btn.jsx';

const DEFAULT_WINDOW_MS = 5000;
const DEFAULT_CONFIRM_LABEL = '再点一次确认';

export default function ConfirmAdvanceBtn({
  onAdvance,
  children,
  confirmLabel = DEFAULT_CONFIRM_LABEL,
  variant = 'primary',
  confirmVariant = 'accent',
  windowMs = DEFAULT_WINDOW_MS,
  ...rest
}) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleClick = () => {
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setConfirming(false);
      if (typeof onAdvance === 'function') onAdvance();
      return;
    }
    setConfirming(true);
    timerRef.current = setTimeout(() => {
      setConfirming(false);
      timerRef.current = null;
    }, windowMs);
  };

  return (
    <Btn
      {...rest}
      variant={confirming ? confirmVariant : variant}
      onClick={handleClick}
    >
      {confirming ? confirmLabel : children}
    </Btn>
  );
}
