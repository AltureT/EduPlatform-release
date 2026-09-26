// 布局原语的公共工具（界面整理规格 §3）：原语只接受 className、data-*、children 与各自 props；
// 传 style 时开发模式 console.warn 并忽略（阶段不得自写尺寸，见规格 §6）。
const DEV = (() => {
  try {
    return !!(import.meta.env && import.meta.env.DEV);
  } catch (_) {
    return false;
  }
})();

export function pickProps(props, name) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'className' || k.startsWith('data-')) out[k] = v;
  }
  if (DEV && props && props.style != null) {
    console.warn(`[layout] <${name}> 不接受 style，已忽略；尺寸与位置交给布局原语与令牌`);
  }
  return out;
}

export function cx(...names) {
  return names.filter(Boolean).join(' ');
}

// gap：1–6 取间距令牌 var(--sp-n)；字符串原样；缺省 fallback
export function gapOf(gap, fallback = 'var(--sp-4)') {
  if (typeof gap === 'number' && gap >= 1 && gap <= 6 && Number.isInteger(gap)) return `var(--sp-${gap})`;
  if (typeof gap === 'string' && gap) return gap;
  if (gap === 0) return 0;
  return fallback;
}
