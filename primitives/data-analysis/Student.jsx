// data-analysis 学生视图：split 模板（Main : Side = 2 : 1；P5：宽屏题目在左、三栏（题目 | 代码 | 输出）可拖宽）。Side 自上而下（P3 审查返工）：
//   "题目" Tile（按内容高完整显示）：题目正文 + "画的图会显示在输出区"（expectImage 时）+ 任务清单（_shared/TaskList，P6 与 code 共用：本地勾选，不采集；带 hint 的任务可展开"提示 ▾"只读代码块）；
//   紧凑数据卡"数据 · 共 N 行 · M 列"：列名与前 3 行 +"查看全部数据"——打开 Overlay（dialog、fill），里面是全宽 DataPreview（筛选、三态排序、≤ 500 行渲染）；
//          数据从服务端下发的 stage.sandbox.files[dataset.path] 解析，options.dataset 只有 { path, rows, columns }（数据内容在仅服务端选项 $server 里，不下发）；
//   宽屏：Side 底部"上交最终稿"（贴底，Side 内容长时也看得见）；窄屏：放 Page.Actions（折叠题目不会收掉）。只读（回看 / 镜像）时只留状态行。
//   确认后发 student:data-final，载荷 = 当前代码 + 最近一次运行结果（代码在那次运行后改过则带 stale）。
// Main 放 sandbox 的 <PyRunner>。每次运行结束自动用 buildRecord 发 student:data-submit（图 ≤ 1 张），以最后一次为准（自动记录）。
// P5 回看（代码段布局与回看规格 §6）：原语缺省 reviewInteractive，回看段能滚动、勾选、看提示与全部数据、编辑、运行，但不发记录、不能上交；
// 操作条第一个 Chip 为"回看 · 运行不记录"（镜像只读时不显示），已有记录时"已记录 …"仍在后面。
// P6（代码段教学功能规格 §2.3）：教师公布参考答案后（perClass.solution），Side 在题目 Tile 之后加"参考答案"面板（_shared/SolutionPanel，可放大）；撤回即消失。
// 数据文件、starter、包来自 stage.sandbox（PyRunner 自己读）；只读态（镜像）由 PyRunner 处理。窄屏时 Side 在上、可折叠，Tile 不再重复"题目"标题。
import { useMemo, useRef, useState } from 'react';
import { useStudentStage, useNarrow, Btn, Chip, Fill, Overlay, Page, Row, Stack, Tile } from '#kernel/client/index.js';
import { PyRunner, buildRecord } from '@components/sandbox/index.js';
import FinalSubmit, { finalRecord } from '../_shared/FinalSubmit.jsx';
import SolutionPanel from '../_shared/SolutionPanel.jsx';
import TaskList from '../_shared/TaskList.jsx';
import DataPreview from './DataPreview.jsx';
import { parseCsv } from './csv.js';

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
const paragraphs = (text) => String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
// 编辑器补全里追加的 pandas / matplotlib 常用名
const EXTRA_COMPLETIONS = [
  'pd', 'plt', 'DataFrame', 'Series', 'read_csv', 'head', 'describe', 'mean', 'groupby', 'sort_values', 'columns',
  'plot', 'bar', 'hist', 'show', 'figure', 'xlabel', 'ylabel', 'title', 'legend', 'savefig', 'set_index',
];
const note = { color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' };
// 题目与数据卡按内容高；上交按钮贴在 Side 底部（sticky：Side 内容长、要滚动时按钮也一直看得见）
const noShrink = { flexShrink: 0, display: 'flex', flexDirection: 'column' };
// bottom / paddingBottom 取负的 Side 内边距：贴到滚动区最底边，盖住下面滚过去的内容
const footer = {
  ...noShrink,
  position: 'sticky',
  bottom: 'calc(var(--sp-3) * -1)',
  marginTop: 'auto',
  marginBottom: 'calc(var(--sp-3) * -1)',
  padding: 'var(--sp-2) 0 var(--sp-3)',
  background: 'var(--surface-alt)',
  borderTop: '1px solid var(--border)',
};
const PEEK_ROWS = 3;
const peekCell = { padding: 'var(--sp-1) var(--sp-2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textAlign: 'left' };

// 紧凑预览：列名 + 前 3 行，只读、不排序
function DataPeek({ columns, rows }) {
  return (
    <div data-testid="data-peek" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 'max(var(--fs-min), var(--fs-sm))', minWidth: '100%' }}>
        <thead>
          <tr>{columns.map((c, j) => <th key={j} scope="col" style={{ ...peekCell, color: 'var(--ink-dim)', fontWeight: 600, background: 'var(--surface-alt)' }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, PEEK_ROWS).map((r, i) => (
            <tr key={i}>{columns.map((_, j) => <td key={j} style={peekCell}>{r[j] ?? ''}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Student({ stageId } = {}) {
  const { stage, options, isLive, readOnly, myData, classData, send } = useStudentStage(stageId);
  const narrow = useNarrow();
  const id = stageId ?? stage?.id;
  const sandbox = stage?.sandbox ?? null;
  const [draft, setDraft] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const runsBase = useRef(null);
  const lastRun = useRef(null);                   // 本页最近一次运行 { code, result }
  const [showAll, setShowAll] = useState(false);
  const code = draft ?? sandbox?.starter ?? '';
  const codeRef = useRef(code);
  codeRef.current = code;

  const path = options?.dataset?.path ?? null;
  const content = path && sandbox?.files ? sandbox.files[path] : undefined;
  const table = useMemo(() => (typeof content === 'string' ? parseCsv(content) : null), [content]);

  if (!options) return <Page template="split" />;

  const onResult = (result, info) => {
    lastRun.current = { code: codeRef.current, result };
    if (!isLive || (result?.interrupted && !result.error)) return;
    if (runsBase.current == null) runsBase.current = Number(myData?.runs) || 0;
    send('student:data-submit', buildRecord(result, { code: codeRef.current, runs: runsBase.current + (info?.runs ?? 0) }));
  };
  const onRestore = ({ code: ranCode, result }) => {
    if (result?.kind !== 'test') lastRun.current = { code: ranCode, result };
  };
  const prepareFinal = () => finalRecord({ code: codeRef.current, run: lastRun.current?.result ?? null, runCode: lastRun.current?.code, myData });
  const submitFinal = (payload) => {
    if (!isLive || !payload) return;
    send('student:data-final', payload);
  };
  const finalProps = { finalAt: myData?.finalAt ?? null, prepare: prepareFinal, onConfirm: submitFinal, hideButton: !isLive || readOnly };
  const toggle = (i) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

  const reviewing = !isLive && !readOnly;
  const tasks = options.tasks ?? [];
  const hasImg = Array.isArray(myData?.images) && myData.images.length > 0;
  const total = table ? table.rows.length : Number(options.dataset?.rows) || 0;
  const dataTitle = `数据 · 共 ${total} 行 · ${table ? table.columns.length : 0} 列`;

  return (
    <Page template="split" ratio="2:1" side="left" resizable sideLabel="题目" title={stage?.label}>
      <Page.Side>
        <div data-side-part="task" style={noShrink}>
          <Tile title={narrow ? undefined : '题目'}>
            <Stack gap={3}>
              <div>
                {paragraphs(options.prompt).map((p, i) => (
                  <p key={i} style={{ margin: '0 0 var(--sp-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{p}</p>
                ))}
                {options.expectImage !== false && <p style={{ ...note, margin: 0 }}>画的图会显示在输出区</p>}
              </div>
              <TaskList items={tasks} note="任务（自己检查，勾选不会上交）" checked={checked} onToggle={toggle} testId="data-tasks" />
            </Stack>
          </Tile>
        </div>
        {typeof classData?.solution === 'string' && classData.solution !== '' && (
          <div data-side-part="solution" style={noShrink}>
            <SolutionPanel solution={classData.solution} />
          </div>
        )}
        {table && table.columns.length > 0 && (
          <div data-side-part="data" style={noShrink}>
            <Tile title={dataTitle} actions={<Btn variant="soft" onClick={() => setShowAll(true)}>查看全部数据</Btn>}>
              <DataPeek columns={table.columns} rows={table.rows} />
            </Tile>
            {showAll && (
              <Overlay variant="dialog" fill testId="data-dialog" label={dataTitle} onDismiss={() => setShowAll(false)}>
                <Row gap={3}>
                  <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--ink)', flex: '1 1 auto', minWidth: 0 }}>{dataTitle}</div>
                  <Btn variant="ghost" onClick={() => setShowAll(false)}>关闭</Btn>
                </Row>
                <Fill>
                  <DataPreview columns={table.columns} rows={table.rows} fill />
                </Fill>
              </Overlay>
            )}
          </div>
        )}
        {!narrow && (
          <div data-side-part="footer" style={footer}>
            <FinalSubmit {...finalProps} />
          </div>
        )}
      </Page.Side>
      <Page.Main>
        {sandbox && id ? (
          <PyRunner stageId={id} code={code} onChange={setDraft} onResult={onResult} onRestore={onRestore} extraCompletions={EXTRA_COMPLETIONS} />
        ) : (
          <div style={{ color: 'var(--ink-dim)' }}>正在准备运行环境…</div>
        )}
      </Page.Main>
      <Page.Actions>
        {reviewing && <Chip>回看 · 运行不记录</Chip>}
        {myData?.submittedAt != null
          ? <Chip tone={hasImg ? 'good' : 'warn'}>已记录 {fmtTime(myData.submittedAt)} · {hasImg ? '有图' : '无图'}</Chip>
          : (reviewing ? null : <Chip tone="neutral">运行后自动记录</Chip>)}
        {narrow && <FinalSubmit {...finalProps} inline />}
      </Page.Actions>
    </Page>
  );
}
