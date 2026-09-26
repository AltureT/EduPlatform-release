// 统一报告输出与退出码
export const EXIT = Object.freeze({ OK: 0, FAIL: 1, SETUP: 2 });

// 东亚宽字符按 2 列计
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

function pad(s, width) {
  return String(s) + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** formatTable(headers, rows) → 多行文本：表头、分隔线、数据行；列间两个空格，行尾不留空格 */
export function formatTable(headers, rows) {
  const cells = [headers, ...rows].map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => displayWidth(r[i] ?? ''))));
  const line = (r) => r.map((c, i) => pad(c, widths[i])).join('  ').replace(/\s+$/, '');
  return [line(cells[0]), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

/** 最近秩百分位：sorted[floor((n-1)·p)]；空数组返回 null */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export function resultLine(code) {
  return `=== RESULT: ${code === EXIT.OK ? 'PASS' : 'FAIL'} (exit ${code}) ===`;
}
