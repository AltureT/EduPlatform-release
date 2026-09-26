import { Fragment, useState } from 'react';
import { useNarrow } from '../layout/useNarrow.js';
import Overlay from '../shells/Overlay.jsx';

// step：live 阶段下标；viewed：正在查看的下标（缺省同 step）
// onSelect(i)：提供后 1 ≤ i ≤ step 可点（下标 0 为课前，不可回看）
// steps：阶段标签数组，必传（来自 classroom:state.stages）
// 界面整理规格 §2.2 / §4：wide 时步骤点 24 px、文字 --fs-sm；narrow 时折叠为 "序号 / 总数 · 名称"（不缩字号），
// 可回看时点开为菜单。编号与宽屏一致：课前不计数，第一个教学阶段为 1，总数不含课前（stepLabel）
// U5：选中态字重 400 ↔ 600 切换不改宽度——可见层与隐藏的粗体占位层叠在同一网格格子里，宽度恒按粗体排。
// 教师端顶栏阶段导航（TeacherApp StageNav）同样用它。占位层 aria-hidden，不进可访问名
export function StableLabel({ weight, children }) {
  return (
    <span style={{ display: 'inline-grid', justifyItems: 'center' }}>
      <span style={{ gridArea: '1 / 1', fontWeight: weight }}>{children}</span>
      <span data-bold-placeholder="" aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden', fontWeight: 600 }}>{children}</span>
    </span>
  );
}

export function stepLabel(steps, i) {
  const label = steps[i] ?? '';
  return i >= 1 ? `${i} / ${steps.length - 1} · ${label}` : label;
}

export default function StepBar({ step, viewed, onSelect, steps }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  if (!Array.isArray(steps)) return null;
  const viewedIdx = typeof viewed === 'number' ? viewed : step;
  const interactive = typeof onSelect === 'function';

  if (narrow) {
    const text = stepLabel(steps, viewedIdx);
    const canPick = interactive && step >= 1;
    const style = {
      fontSize: 'var(--fs-sm)',
      fontWeight: 600,
      color: viewedIdx === step ? 'var(--ink)' : 'var(--brand)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      minWidth: 0,
    };
    return (
      <>
        {canPick ? (
          <button
            type="button"
            data-testid="stepbar-collapsed"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            style={{
              ...style,
              height: 'var(--control-h)',
              padding: '0 var(--sp-3)',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              borderRadius: 999,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {text}
          </button>
        ) : (
          <div data-testid="stepbar-collapsed" style={style}>{text}</div>
        )}
        {open && (
          <Overlay variant="menu" testId="stepbar-menu" onDismiss={() => setOpen(false)}>
            {steps.map((s, i) => {
              const clickable = i >= 1 && i <= step;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!clickable}
                  aria-current={i === step ? 'step' : undefined}
                  onClick={() => { setOpen(false); onSelect(i); }}
                  style={{
                    height: 'var(--control-h)',
                    padding: '0 var(--sp-4)',
                    textAlign: 'left',
                    background: i === viewedIdx ? 'var(--brand-soft)' : 'transparent',
                    color: clickable || i === step ? 'var(--ink)' : 'var(--ink-dim)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--fs-md)',
                    fontWeight: i === step ? 600 : 400,
                    cursor: clickable ? 'pointer' : 'default',
                    fontFamily: 'inherit',
                  }}
                >
                  {i >= 1 ? `${i}. ${s}` : s}
                </button>
              );
            })}
          </Overlay>
        )}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' }}>
      {steps.map((s, i) => {
        const isCurrent = i === step;
        const isViewed = i === viewedIdx;
        const isDone = i < step;
        const clickable = interactive && i >= 1 && i <= step;
        const dotBg = isViewed
          ? 'var(--brand)'
          : isCurrent
            ? 'var(--accent)'
            : isDone
              ? 'var(--ink-dim)'
              : 'var(--surface-alt)';
        const dotColor = (isViewed || isCurrent || isDone) ? 'var(--surface)' : 'var(--ink-dim)';
        const labelColor = isViewed ? 'var(--brand)' : isCurrent ? 'var(--ink)' : 'var(--ink-dim)';
        return (
          <Fragment key={i}>
            <button
              type="button"
              onClick={clickable ? () => onSelect(i) : undefined}
              disabled={!clickable}
              aria-current={isCurrent ? 'step' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: 0,
                minHeight: 'var(--control-h)',
                background: 'transparent',
                border: 'none',
                cursor: clickable ? 'pointer' : 'default',
                fontFamily: 'inherit',
                flexShrink: 0,
                opacity: !interactive || clickable || isCurrent ? 1 : 0.55,
              }}
            >
              <div style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                background: dotBg,
                color: dotColor,
                fontSize: 'var(--fs-min)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: isViewed && !isCurrent ? '2px solid var(--brand)' : 'none',
                outlineOffset: 1,
              }}>
                {isDone && !isViewed ? '✓' : i}
              </div>
              <div style={{
                fontSize: 'var(--fs-sm)',
                color: labelColor,
                whiteSpace: 'nowrap',
              }}>
                <StableLabel weight={isViewed || isCurrent ? 600 : 400}>{s}</StableLabel>
              </div>
            </button>
            {i < steps.length - 1 && (
              <div style={{ width: 8, height: 1, background: 'var(--border)', flexShrink: 0 }} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
