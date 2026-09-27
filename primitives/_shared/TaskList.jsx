// code 的要求清单与 data-analysis 的任务清单共用（代码段教学功能规格 §3，P6；原 data-analysis 的任务清单抽出）。只给原语作者用。
//
//   <TaskList items note checked onToggle testId />
//   items：条目数组（字符串或 { text, hint }，见 taskItem.js）；为空时不渲染
//   note：清单上方一行灰字（如"要求（自己检查，勾选不会上交）"）
//   checked：已勾选下标的 Set；onToggle(i)：勾选 / 取消（勾选只在本地，是自检，不采集）——状态放在原语视图里，窄屏折叠题目时不丢
//   带 hint 的条目：勾选框那行下方 <details data-task-hint>"提示 ▾"，展开成只读代码块 <CodeView size="sm" wrap>（高亮、折行、可选中复制；U6）
import { CodeView, Stack } from '#kernel/client/index.js';
import { taskHint, taskText } from './taskItem.js';

const checkRow = { display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start', cursor: 'pointer', lineHeight: 1.5 };
const note = { color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' };

export default function TaskList({ items, note: noteText, checked, onToggle, testId }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  return (
    <Stack gap={2} data-testid={testId}>
      {noteText && <div style={note}>{noteText}</div>}
      {list.map((t, i) => {
        const text = taskText(t);
        const hint = taskHint(t);
        return (
          <div key={i}>
            <label style={checkRow}>
              <input type="checkbox" checked={!!checked?.has(i)} onChange={() => onToggle?.(i)} aria-label={text} />
              <span>{text}</span>
            </label>
            {hint && (
              <details data-task-hint="" style={{ marginTop: 'var(--sp-1)' }}>
                <summary style={{ ...note, cursor: 'pointer' }}>提示 ▾</summary>
                <div style={{ marginTop: 'var(--sp-1)' }}><CodeView code={hint} size="sm" wrap /></div>
              </details>
            )}
          </div>
        );
      })}
    </Stack>
  );
}
