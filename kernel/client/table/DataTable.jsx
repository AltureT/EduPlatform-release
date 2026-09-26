// 规格 §9.3：DataTable({ columns, rows, rowKey, defaultSort, onRowClick, paused, flip, offlineKey, locale })
// - columns: [{ key, label, accessor(row), align, render(row), sortable }]；sortable 缺省为 true（需有 accessor）
// - rowKey: 字段名或 (row) => key
// 约定（已获协调方认可）：
// - paused 未传时跟随 coreTeacherStore.statsPaused（阶段视图的 hook 不返回暂停态），
//   待更新条数取 store 的 statsPending（store 已冻结 stageData，行级计数数不到推送）；
//   v0.7（界面整理规格 §2.2）：暂停按钮不再渲染在表内，由教师外壳操作条的"暂停更新"控制；
//   传了布尔 paused 则由调用方控制，待更新条数为行级冻结期间的变化次数
// - v0.7 尺寸（规格 §3、§4）：表格包在 <Scroll> 里，表头 sticky、高 36，行高 --row-h，字号不低于 --fs-min
// - offlineKey: 行里该字段严格等于 false 时灰显（如 offlineKey="connected"）
import { useMemo, useRef } from 'react';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import { useColumnSort, applySort } from './useColumnSort.js';
import { useFreezeOnPause } from './useFreezeOnPause.js';
import { useFlipPositions } from './useFlipPositions.js';
import SortHeader from './SortHeader.jsx';
import Scroll from '../layout/Scroll.jsx';

const EMPTY_ROWS = [];

function keyOf(row, rowKey, i) {
  if (typeof rowKey === 'function') return rowKey(row);
  if (typeof rowKey === 'string' && row && row[rowKey] != null) return row[rowKey];
  return i;
}

export default function DataTable({
  columns = [],
  rows = EMPTY_ROWS,
  rowKey,
  defaultSort,
  onRowClick,
  paused,
  flip = false,
  offlineKey,
  locale = 'zh',
}) {
  const storePaused = coreTeacherStore((s) => s.statsPaused);
  const storePending = coreTeacherStore((s) => s.statsPending);
  const controlled = typeof paused === 'boolean';
  const isPaused = controlled ? paused : storePaused;

  const [shownRows, rowPending] = useFreezeOnPause(Array.isArray(rows) ? rows : EMPTY_ROWS, isPaused);
  const pendingCount = controlled ? rowPending : (isPaused ? storePending : 0);
  const sort = useColumnSort(defaultSort && defaultSort.key, (defaultSort && defaultSort.dir) || 'desc');

  const accessors = useMemo(() => {
    const out = {};
    for (const c of columns) if (typeof c.accessor === 'function') out[c.key] = c.accessor;
    return out;
  }, [columns]);

  const sorted = useMemo(
    () => applySort(shownRows, accessors, sort.key, sort.dir, locale),
    [shownRows, accessors, sort.key, sort.dir, locale],
  );

  const keys = sorted.map((r, i) => String(keyOf(r, rowKey, i)));
  const rowRefs = useRef({});
  useFlipPositions(keys, rowRefs, !!flip);

  const clickable = typeof onRowClick === 'function';

  return (
    <div
      data-testid="datatable"
      data-pending={String(pendingCount)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: '0 1 auto',
        minHeight: 0,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <Scroll>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 'max(var(--fs-min), var(--fs-sm))' }}>
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false && typeof c.accessor === 'function';
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      background: 'var(--surface-alt)',
                      color: 'var(--ink-dim)',
                      fontWeight: 600,
                      textAlign: c.align || 'left',
                      height: 36,
                      padding: '0 12px',
                      borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sortable ? (
                      <SortHeader
                        label={c.label}
                        sortKey={c.key}
                        currentKey={sort.key}
                        currentDir={sort.dir}
                        onSort={sort.toggle}
                        align={c.align || 'left'}
                      />
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const k = keys[i];
              const offline = !!offlineKey && row && row[offlineKey] === false;
              return (
                <tr
                  key={k}
                  data-testid="datatable-row"
                  data-offline={offline ? 'true' : 'false'}
                  ref={(el) => { if (el) rowRefs.current[k] = el; else delete rowRefs.current[k]; }}
                  onClick={clickable ? () => onRowClick(row) : undefined}
                  style={{
                    cursor: clickable ? 'pointer' : 'default',
                    opacity: offline ? 0.45 : 1,
                    color: offline ? 'var(--ink-dim)' : 'var(--ink)',
                  }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        textAlign: c.align || 'left',
                        height: 'var(--row-h)',
                        padding: '4px 12px',
                        borderBottom: '1px solid var(--border)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {typeof c.render === 'function'
                        ? c.render(row)
                        : formatCell(typeof c.accessor === 'function' ? c.accessor(row) : undefined)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Scroll>
    </div>
  );
}

function formatCell(v) {
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '—';
  if (typeof v === 'boolean') return v ? '✓' : '—';
  return String(v);
}
