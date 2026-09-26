// studentBanner 槽位（契约 v0.7.1 §八；界面整理规格 v0.2.2 §2.2）：Python 运行环境加载失败时，学生外壳横幅区的一行
// "Python：<原因> [重试] [收起]"；不挡页面、行高不超过 --control-h（文案过长时最多两行后省略，title 给全文）。
// 状态来自 studentOverlay（loadAlert.js）；浏览器太旧（S3）时没有 [重试]。无提示或已收起时返回 null（横幅区不占位）
import { useSyncExternalStore } from 'react';
import { useComponent, Btn } from '#kernel/client/index.js';
import { getLoadAlert, setLoadAlert, subscribeLoadAlert } from './loadAlert.js';

export default function StudentBanner() {
  const c = useComponent('sandbox');
  const a = useSyncExternalStore(subscribeLoadAlert, getLoadAlert, getLoadAlert);
  if (c.role !== 'student' || !a.message || a.hidden) return null;
  const text = `Python：${a.message}`;
  return (
    <div
      role="alert"
      data-sandbox-alert=""
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        maxHeight: 'var(--control-h)',
        padding: '0 var(--sp-4)',
        background: 'var(--bad-soft)',
        color: 'var(--bad)',
        fontSize: 'var(--fs-sm)',
        overflow: 'hidden',
      }}
    >
      <span
        title={text}
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          lineHeight: 1.25,
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden',
        }}
      >
        {text}
      </span>
      {typeof a.retry === 'function' && <Btn variant="accent" onClick={a.retry}>重试</Btn>}
      <Btn variant="ghost" onClick={() => setLoadAlert({ hidden: true })}>收起</Btn>
    </div>
  );
}
