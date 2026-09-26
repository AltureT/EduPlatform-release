// data-analysis 的数据预览表（活动原语规格 §3.5，P3）：全量数据、筛选、三态排序。只依赖内核公开原语，不引依赖。
// （内核 DataTable 的排序只有升 / 降两态、换列缺省降序，且跟随教师端"暂停更新"，不合用，所以在原语内实现。）
//   <DataPreview columns rows fill? />
//   fill（宽屏）：在纵向 flex 父级里撑满剩余高度，表格框随之撑满、在 <Scroll> 里内部滚动；缺省（窄屏）表格框最高约 12 行
//   - 筛选框：子串匹配任意单元格（不分大小写），即时过滤，框右边显示"筛选后 n 行"
//   - 列头可点排序：数字列（非空单元格全是数）按数值、其它按字符串；升 → 降 → 取消，箭头 ↑ / ↓ 指示；空单元格沉底
//   - 表格在 <Scroll> 里内部滚动（最高约 12 行）；超过 500 行只渲染前 500 行并提示"只显示前 500 行，全部数据可用代码读取"
import { useMemo, useState } from 'react';
import { Scroll } from '#kernel/client/index.js';

export const MAX_RENDER = 500;
const isNum = (v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
const note = { color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' };
const cellPad = 'var(--sp-1) var(--sp-2)';

const inputStyle = {
  height: 'var(--control-h)',
  padding: '0 var(--sp-3)',
  font: 'inherit',
  fontSize: 'var(--fs-sm)',
  color: 'var(--ink)',
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  minWidth: 0,
  width: '100%',
};
const frame = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface)',
  overflow: 'hidden',
};
const thStyle = {
  position: 'sticky',
  top: 0,
  background: 'var(--surface-alt)',
  borderBottom: '1px solid var(--border)',
  padding: 0,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};
const sortBtn = (active) => ({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: 'var(--control-h-sm)',
  padding: cellPad,
  background: 'none',
  border: 'none',
  font: 'inherit',
  fontWeight: active ? 700 : 600,
  color: active ? 'var(--accent)' : 'var(--ink-dim)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});
const tdStyle = { padding: cellPad, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

// 两个非空单元格比大小（空单元格由调用方处理：无论升降都沉底）
const compare = (a, b, numeric) => (numeric ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'zh'));

const rootStyle = (fill) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  minWidth: 0,
  ...(fill ? { flex: '1 1 0%', minHeight: 0 } : {}),
});

export default function DataPreview({ columns = [], rows = [], fill = false }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(null);   // { col, dir: 'asc' | 'desc' } | null

  const numeric = useMemo(() => columns.map((_, j) => {
    const vals = rows.map((r) => r[j] ?? '').filter((v) => v.trim() !== '');
    return vals.length > 0 && vals.every(isNum);
  }), [columns, rows]);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? rows.filter((r) => r.some((c) => String(c ?? '').toLowerCase().includes(needle))) : rows),
    [rows, needle],
  );
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const sign = sort.dir === 'asc' ? 1 : -1;
    const num = numeric[sort.col];
    return filtered
      .map((r, i) => [r, i])
      .sort(([a, i], [b, k]) => {
        const ea = (a[sort.col] ?? '').trim() === '';
        const eb = (b[sort.col] ?? '').trim() === '';
        if (ea || eb) return ea === eb ? i - k : (ea ? 1 : -1);   // 空值无论升降都沉底
        return compare(a[sort.col], b[sort.col], num) * sign || i - k;
      })
      .map(([r]) => r);
  }, [filtered, sort, numeric]);
  const shown = sorted.length > MAX_RENDER ? sorted.slice(0, MAX_RENDER) : sorted;

  const cycle = (col) => setSort((cur) => {
    if (!cur || cur.col !== col) return { col, dir: 'asc' };
    if (cur.dir === 'asc') return { col, dir: 'desc' };
    return null;
  });

  return (
    <div data-data-preview-root="" style={rootStyle(fill)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0, minWidth: 0 }}>
      <input
        type="search"
        aria-label="筛选数据"
        placeholder="筛选：输入任意内容"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        style={{ ...inputStyle, flex: '1 1 auto' }}
      />
      {needle && <span style={{ ...note, flexShrink: 0, whiteSpace: 'nowrap' }}>筛选后 {filtered.length} 行</span>}
      </div>
      <div data-testid="data-preview" style={fill ? { ...frame, flex: '1 1 0%', minHeight: 0 } : { ...frame, maxHeight: 'calc(var(--row-h) * 12)' }}>
        <Scroll>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 'max(var(--fs-min), var(--fs-sm))', minWidth: '100%' }}>
            <thead>
              <tr>
                {columns.map((label, j) => {
                  const active = sort && sort.col === j;
                  const arrow = active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
                  return (
                    <th
                      key={j}
                      scope="col"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      style={{ ...thStyle, textAlign: numeric[j] ? 'right' : 'left' }}
                    >
                      <button type="button" onClick={() => cycle(j)} style={{ ...sortBtn(!!active), justifyContent: numeric[j] ? 'flex-end' : 'flex-start' }}>
                        {`${label}${arrow}`}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i}>
                  {columns.map((_, j) => (
                    <td key={j} style={{ ...tdStyle, textAlign: numeric[j] ? 'right' : 'left' }}>{r[j] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </div>
      {sorted.length > MAX_RENDER && <div style={{ ...note, flexShrink: 0 }}>只显示前 {MAX_RENDER} 行，全部数据可用代码读取</div>}
    </div>
  );
}
