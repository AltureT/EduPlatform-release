import { useState } from 'react';

// 即时显示的悬停气泡，包裹任意触发元素；保留 aria-label
export default function HelpTip({ text, children, wrapperStyle = {} }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      tabIndex={0}
      role="group"
      aria-label={text}
      style={{
        position: 'relative',
        cursor: 'pointer',
        outline: 'none',
        ...wrapperStyle,
      }}
    >
      {children}
      {hover && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 9px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--surface)',
            border: '1.5px solid var(--accent)',
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 'clamp(11px, 0.9vw, 13px)',
            lineHeight: 1.5,
            color: 'var(--ink)',
            minWidth: 200,
            maxWidth: 320,
            width: 'max-content',
            boxShadow: 'var(--shadow)',
            pointerEvents: 'none',
            whiteSpace: 'normal',
            zIndex: 20,
            fontFamily: 'inherit',
            fontWeight: 400,
            textAlign: 'left',
          }}
        >
          {text}
          <div style={{
            position: 'absolute',
            bottom: -7,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: '7px solid var(--surface)',
            filter: 'drop-shadow(0 1.5px 0 var(--accent))',
          }} />
        </div>
      )}
    </div>
  );
}
