// data-analysis 学生视图：split 模板（Main : Side = 2 : 1；P5：宽屏题目在左、三栏（题目 | 代码 | 输出）可拖宽）。Side 自上而下（P3 审查返工）：
//   "题目" Tile（按内容高完整显示）：题目正文 + "画的图会显示在输出区"（expectImage 时）+ 任务清单（_shared/TaskList，P6 与 code 共用：本地勾选，不采集；带 hint 的任务可展开"提示 ▾"只读代码块）；
//   紧凑数据卡"数据 · 共 N 行 · M 列"：列名与前 3 行 +"查看全部数据"——打开 Overlay（dialog、fill），里面是全宽 DataPreview（筛选、三态排序、≤ 500 行渲染）；
//          数据从服务端下发的 stage.sandbox.files[dataset.path] 解析，options.dataset 只有 { path, rows, columns }（数据内容在仅服务端选项 $server 里，不下发）；
//   T9b（教师视图与学生页重排规格 §2.4）：宽屏"上交最终稿"放代码框下方工具栏最右（经 PyRunner 的 toolbarEnd），Side 底部不再放；
//   窄屏：放 Page.Actions（折叠题目不会收掉）。只读（回看 / 镜像）时不放按钮。
//   S22（上课细节收口规格 §4）：状态只在操作条一枚 Chip（data-testid="final-status"，HH:MM）：没有记录"运行后自动保存"；
//   有记录"已自动保存 HH:MM · 有图 / 无图"；已上交"已上交 HH:MM"（之后又运行过：" · 之后又运行过"，warn）；按钮三态见 FinalSubmit（dirty 同 code）。
//   确认后发 student:data-final，载荷 = 当前代码 + 最近一次运行结果（代码在那次运行后改过则带 stale）。
// Main 放 sandbox 的 <PyRunner>。每次运行结束自动用 buildRecord 发 student:data-submit（图 ≤ 1 张），以最后一次为准（自动记录）。
// P5 回看（代码段布局与回看规格 §6）：原语缺省 reviewInteractive，回看段能滚动、勾选、看提示与全部数据、编辑、运行，但不发记录、不能上交；
// 操作条第一个 Chip 为"回看 · 运行不记录"（镜像只读时不显示），已有记录时状态 Chip 仍在后面。
// P6（代码段教学功能规格 §2.3）：教师公布参考答案后（perClass.solution），Side 在题目 Tile 之后加"参考答案"面板（_shared/SolutionPanel，可放大）；撤回即消失。
// 数据文件、starter、包来自 stage.sandbox（PyRunner 自己读）；只读态（镜像）由 PyRunner 处理。窄屏时 Side 在上、可折叠，Tile 不再重复"题目"标题。
// P7（教师现场演示规格 §5）：班级记录有老师下发的代码（perClass.pushedCode）且本段是当前段、这次下发还没采用 → 操作条
// "老师发来一份代码"芯片 +"看一看"（_shared/PushedCode）；"换成这份"：程序在跑先 stop()、世代 +1 丢弃旧回调、编辑器换成下发的代码；
// 采用后 student:data-submit / data-final 带 fromTeacher: true。
// D1（学生输入自动保存规格 §2.4）：任务勾选 useDraft('checked', [])；代码除 PyRunner 的本地草稿外，另用 useDraft('code', null, { local: false })
// 只走服务端层。起始代码取值链：本地 sandbox 草稿（PyRunner 挂载时交回）→ 服务端 code 草稿 → myData.final?.code ?? myData.code → starter；
// PyRunner onChange 同时写服务端草稿（≤ 20000 字）。
// T9a 教师演示模式（教师视图与学生页重排规格 §2.2；useStudentStage().demo）：Side（题目、任务勾选本地、参考答案、数据卡）照常；
// Main 为 _shared/DemoTools 的 <DemoRunner>（<PyRunner role="teacher">，同一份沙盒配置含数据文件，代码存本地演示记录，工具栏右端：
// 载入起始代码 / 载入参考答案 / 下发给学生 / 已下发 HH:MM · 撤回）；没有"上交最终稿"、"老师发来一份代码"，操作条不放东西。
import { useMemo, useRef, useState } from 'react';
import { useStudentStage, useComponent, useNarrow, useDraft, Btn, Chip, Fill, Overlay, Page, Row, Stack, Tile } from '#kernel/client/index.js';
import { PyRunner, buildRecord, usePython } from '@components/sandbox/index.js';
import FinalSubmit, { finalRecord, fmtHM } from '../_shared/FinalSubmit.jsx';
import SolutionPanel from '../_shared/SolutionPanel.jsx';
import TaskList from '../_shared/TaskList.jsx';
import { PushedCodeOffer, usePushedCode } from '../_shared/PushedCode.jsx';
import DataPreview from './DataPreview.jsx';
import { parseCsv } from './csv.js';
import DemoRunner from '../_shared/DemoTools.jsx';

const paragraphs = (text) => String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
// 编辑器补全里追加的 pandas / matplotlib 常用名
const EXTRA_COMPLETIONS = [
  'pd', 'plt', 'DataFrame', 'Series', 'read_csv', 'head', 'describe', 'mean', 'groupby', 'sort_values', 'columns',
  'plot', 'bar', 'hist', 'show', 'figure', 'xlabel', 'ylabel', 'title', 'legend', 'savefig', 'set_index',
];
const CODE_DRAFT_MAX = 20000;   // 服务端代码草稿上限（字）
const note = { color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' };
// 题目与数据卡按内容高
const noShrink = { flexShrink: 0, display: 'flex', flexDirection: 'column' };
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
  const { stage, options, isLive, readOnly, myData, classData, send, demo } = useStudentStage(stageId);
  const narrow = useNarrow();
  const id = stageId ?? stage?.id;
  const sandbox = stage?.sandbox ?? null;
  const [draft, setDraft] = useState(null);
  const [serverCode, setServerCode] = useDraft('code', null, { stageId: id, local: false });
  const [checkedRaw, setCheckedList] = useDraft('checked', [], { stageId: id });
  const checked = useMemo(() => new Set(Array.isArray(checkedRaw) ? checkedRaw.filter((i) => Number.isInteger(i)) : []), [checkedRaw]);
  const runsBase = useRef(null);
  const lastRun = useRef(null);                   // 本页最近一次运行 { code, result }
  const lastFinalCode = useRef(null);             // S22a：本页最近一次上交 { id, code }（推回来的 final 可能是摘要；外壳换段不换实例，只认本段 id）
  const [showAll, setShowAll] = useState(false);
  const recordCode = typeof myData?.final?.code === 'string' ? myData.final.code : (typeof myData?.code === 'string' ? myData.code : null);
  const code = draft ?? (typeof serverCode === 'string' ? serverCode : recordCode) ?? sandbox?.starter ?? '';
  const codeRef = useRef(code);
  codeRef.current = code;

  // P7：老师下发的代码
  const comp = useComponent('sandbox');
  const keyArgs = { lessonId: comp.lesson?.id ?? null, classEpoch: comp.classEpoch, name: comp.me?.name, stageId: id };
  const pushedCode = usePushedCode({ classData, isLive, readOnly, keyArgs });
  const py = usePython();
  const running = py.status === 'running' || py.status === 'waiting-input';
  const genRef = useRef(0);   // 换成下发代码的世代：之前那次 render 交出去的 onResult 丢弃
  const gen = genRef.current;

  const path = options?.dataset?.path ?? null;
  const content = path && sandbox?.files ? sandbox.files[path] : undefined;
  const table = useMemo(() => (typeof content === 'string' ? parseCsv(content) : null), [content]);

  if (!options) return <Page template="split" />;

  const mark = (rec) => (pushedCode.fromTeacher ? { ...rec, fromTeacher: true } : rec);
  const onResult = (result, info) => {
    if (gen !== genRef.current) return;
    lastRun.current = { code: codeRef.current, result };
    if (!isLive || (result?.interrupted && !result.error)) return;
    if (runsBase.current == null) runsBase.current = Number(myData?.runs) || 0;
    send('student:data-submit', mark(buildRecord(result, { code: codeRef.current, runs: runsBase.current + (info?.runs ?? 0) })));
  };
  const adoptPushed = (p) => {
    genRef.current += 1;
    if (running) py.stop();
    lastRun.current = null;
    onCodeChange(p.code);
    pushedCode.markAdopted();
  };
  const onRestore = ({ code: ranCode, result }) => {
    if (result?.kind !== 'test') lastRun.current = { code: ranCode, result };
  };
  const prepareFinal = () => {
    const rec = finalRecord({ code: codeRef.current, run: lastRun.current?.result ?? null, runCode: lastRun.current?.code, myData });
    return rec ? mark(rec) : rec;
  };
  const submitFinal = (payload) => {
    if (!isLive || !payload) return;
    lastFinalCode.current = typeof payload.code === 'string' ? { id, code: payload.code } : null;
    send('student:data-final', payload);
  };
  const finalAt = myData?.finalAt ?? null;
  // 上交后推回来的 final 是摘要（K10，没有 code）：用本页记住的上交代码比；刷新后两者都没有时按没改过（Chip"之后又运行过"兜底）
  const localFinal = lastFinalCode.current && lastFinalCode.current.id === id ? lastFinalCode.current.code : null;
  const finalCode = localFinal ?? (typeof myData?.final?.code === 'string' ? myData.final.code : null);
  const dirty = finalAt != null && finalCode != null && finalCode !== code;
  const hideFinal = !isLive || readOnly;
  const finalProps = { finalAt, dirty, prepare: prepareFinal, onConfirm: submitFinal, hideButton: hideFinal };
  const toggle = (i) => setCheckedList((prev) => {
    const list = Array.isArray(prev) ? prev : [];
    return list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort((a, b) => a - b);
  });
  // 编辑器改动：本页状态 + 服务端草稿（≤ 20000 字；本地草稿由 PyRunner 自己写）
  const onCodeChange = (v) => {
    setDraft(v);
    if (typeof v === 'string' && v.length <= CODE_DRAFT_MAX) setServerCode(v);
  };

  const reviewing = !isLive && !readOnly;
  const tasks = options.tasks ?? [];
  const hasImg = Array.isArray(myData?.images) && myData.images.length > 0;
  const ranAfter = finalAt != null && myData?.submittedAt != null && myData.submittedAt > finalAt;
  const status = finalAt != null
    ? <Chip tone={ranAfter ? 'warn' : 'good'} data-testid="final-status">{`已上交 ${fmtHM(finalAt)}${ranAfter ? ' · 之后又运行过' : ''}`}</Chip>
    : myData?.submittedAt != null
      ? <Chip tone={hasImg ? 'good' : 'warn'} data-testid="final-status">{`已自动保存 ${fmtHM(myData.submittedAt)} · ${hasImg ? '有图' : '无图'}`}</Chip>
      : (reviewing ? null : <Chip tone="neutral" data-testid="final-status">运行后自动保存</Chip>);
  const total = table ? table.rows.length : Number(options.dataset?.rows) || 0;
  const dataTitle = `数据 · 共 ${total} 行 · ${table ? table.columns.length : 0} 列`;

  const side = (
    <>
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
    </>
  );

  if (demo) {
    return (
      <Page template="split" ratio="2:1" side="left" resizable sideLabel="题目" title={stage?.label}>
        <Page.Side>{side}</Page.Side>
        <Page.Main>
          {sandbox && id
            ? <DemoRunner stageId={id} starters={[{ label: '起始代码', code: options.starter ?? sandbox?.starter ?? '' }]} solution={options.solution} extraCompletions={EXTRA_COMPLETIONS} />
            : <div style={{ color: 'var(--ink-dim)' }}>正在准备运行环境…</div>}
        </Page.Main>
      </Page>
    );
  }

  return (
    <Page template="split" ratio="2:1" side="left" resizable sideLabel="题目" title={stage?.label}>
      <Page.Side>{side}</Page.Side>
      <Page.Main>
        {sandbox && id ? (
          <PyRunner stageId={id} code={code} onChange={onCodeChange} onResult={onResult} onRestore={onRestore} extraCompletions={EXTRA_COMPLETIONS}
            toolbarEnd={narrow || hideFinal ? undefined : <FinalSubmit {...finalProps} />}
          />
        ) : (
          <div style={{ color: 'var(--ink-dim)' }}>正在准备运行环境…</div>
        )}
      </Page.Main>
      <Page.Actions>
        {reviewing && <Chip>回看 · 运行不记录</Chip>}
        {status}
        <PushedCodeOffer offer={pushedCode.offer} running={running} onAdopt={adoptPushed} />
        {narrow && <FinalSubmit {...finalProps} />}
      </Page.Actions>
    </Page>
  );
}
