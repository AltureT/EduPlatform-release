// 调色板（与 global.css :root 一一对应）。lesson.config.theme 以同名 camelCase 键覆盖，
// 例如 { brand: '#2B3A55' } → --brand。
export const theme = {
  bg: '#FAF7F2',
  ink: '#2B2824',
  inkSoft: '#6B6359',
  inkDim: '#9B9388',
  brand: '#2B3A55',
  accent: '#D97757',
  good: '#4F7A4A',
  bad: '#B04A3D',
  warn: '#C4873B',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F2ED',
  border: 'rgba(43, 40, 36, 0.1)',
  borderStrong: 'rgba(43, 40, 36, 0.2)',
  shadow: '0 1px 2px rgba(60,45,20,.04), 0 8px 24px rgba(60,45,20,.05)',
  shadowSoft: '0 1px 3px rgba(60,45,20,.06)',
  radius: '14px',
  radiusSm: '10px',

  goodSoft: 'rgba(79, 122, 74, 0.1)',
  badSoft: 'rgba(176, 74, 61, 0.1)',
  warnSoft: 'rgba(196, 135, 59, 0.1)',
  accentSoft: 'rgba(217, 119, 87, 0.1)',
  brandSoft: 'rgba(43, 58, 85, 0.08)',
  overlay: 'rgba(43, 40, 36, 0.55)',

  // U6 代码配色（代码展示统一高亮规格 §3）：<CodeView> 的 tok-* 与编辑器共用；浅色一套，参考 CodeMirror 默认配色、按浅底取深一档
  codeKeyword: '#770088',
  codeString: '#AA1111',
  codeComment: '#994400',
  codeNumber: '#116644',
  codeDef: '#0033CC',
  codeBuiltin: '#221199',
  codeOperator: 'var(--ink-soft)',
  codeVariable: 'var(--ink)',
  codeBg: 'var(--surface-alt)',
  // U6 等宽字体栈（代码、报错行、CodeView）：原语与自写段写 fontFamily: 'var(--font-mono)'，不复制字体串
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

export function tokenName(key) {
  return `--${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

// 把覆盖项写到 :root；返回实际写入的变量名列表
export function applyTheme(overrides, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root || !overrides || typeof overrides !== 'object') return [];
  const written = [];
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const name = tokenName(k);
    root.style.setProperty(name, String(v));
    written.push(name);
  }
  return written;
}
