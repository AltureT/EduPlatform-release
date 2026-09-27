// code 学生视图：split 模板（Main : Side = 3 : 1；P5：宽屏题目在左、三栏（题目 | 代码 | 输出）可拖宽）。Side 放标题为"题目"的 Tile：题目正文（空行分段）+ 要求清单（本地勾选，自检用，不采集；
// P6：_shared/TaskList，与 data-analysis 的任务清单共用，{ text, hint } 条目下可展开"提示 ▾"）
// + 底部"上交最终稿"（_shared/FinalSubmit：确认后发 student:code-final，载荷 = 当前代码 + 最近一次运行结果，代码在那次运行后改过则带 stale）；
// 窄屏时"上交最终稿"与状态放 Page.Actions（折叠题目不会把它收掉）；只读（回看 / 镜像）时只留状态行；
// P5 回看（代码段布局与回看规格 §6）：原语缺省 reviewInteractive，回看段能滚动、勾选、编辑、运行、测试，但不发记录、不能上交；
// 操作条第一个 Chip 为"回看 · 运行不记录"（镜像只读时不显示），已有记录时"已记录 …"仍在后面。
// Main 放 sandbox 的 <PyRunner>（运行 / 停止 / 测试；代码 / 输出小标题）。每次运行或测试结束自动用 buildRecord 发 student:code-submit，
// 以最后一次为准（自动记录）。测试结果只对测试时的代码有效：改了代码再运行，记录里的 tests 为 null。
// sandbox 配置（starter / tests / files / packages）来自服务端下发的 stage.sandbox；PyRunner 自己读它，只读态（镜像）也由它处理。
// 窄屏时 Side 在上、可折叠（Page 提供"题目 ▾"一行），Tile 不再重复标题。
// P6（代码段教学功能规格 §2.3）：教师公布参考答案后（perClass.solution），Side 在题目 Tile 之后加"参考答案"面板（_shared/SolutionPanel，可放大）；
// 撤回即消失；回看与镜像照常显示（班级记录不因回看而变）。
// P6（§4.2）：options.starters 有 ≥ 2 份、本段没有草稿也没选过（localStorage 的 starterKey、记录里的 starterLabel 都没有）时，
// Main 先放"选一个起点"（StarterPicker），选定后记 label 再渲染 PyRunner（starter = 那份代码）；当前段操作条"换起点"→ 确认框 →
// 清掉本段草稿与选择、回到选择页（PyRunner 先卸载、再在 effect 里清，避免它卸载时把草稿写回）；回看 / 镜像不显示"换起点"、镜像不显示选择页。
// 选过的学生每次 student:code-submit / student:code-final 带 starterLabel。
// P6 审查 B1：换起点时程序还在运行（usePython().status 为 running / waiting-input）→ 确认框先说明"程序还在运行，换起点会先停止它"，
// 确认后先 stop() 再卸载 PyRunner；世代计数 genRef：切换之前那次 render 交出去的 onResult / onTest 回调一律丢弃（PyRunner 卸载后也不再回调）。
// S3：换起点后在起点键写"待选"标记（STARTER_PENDING），还没选就刷新也回到选择页，不采用服务端记录里的旧 starterLabel。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudentStage, useComponent, useNarrow, Btn, Chip, Overlay, Page, Stack, Tile } from '#kernel/client/index.js';
import { STARTER_PENDING, clearDraft, draftKey, readDraft, readStarter, starterKey, writeStarter } from '#components/sandbox/client/ui/draftStorage.js';
import { PyRunner, buildRecord, usePython } from '@components/sandbox/index.js';
import FinalSubmit, { finalRecord } from '../_shared/FinalSubmit.jsx';
import SolutionPanel from '../_shared/SolutionPanel.jsx';
import TaskList from '../_shared/TaskList.jsx';
import StarterPicker from './StarterPicker.jsx';

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
const paragraphs = (text) => String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const passedAll = (t) => !!t && t.total > 0 && t.failed + t.errors === 0;

// Side 里的 Tile 按内容高、不被压缩（内容长时 Side 整体滚动）
const noShrink = { flexShrink: 0, display: 'flex', flexDirection: 'column' };

export default function Student({ stageId } = {}) {
  const { stage, options, isLive, readOnly, myData, classData, send } = useStudentStage(stageId);
  const narrow = useNarrow();
  const id = stageId ?? stage?.id;
  const sandbox = stage?.sandbox ?? null;
  const [draft, setDraft] = useState(null);      // null = 还没改过，用 starter
  const [checked, setChecked] = useState(() => new Set());
  const lastRun = useRef(null);                   // { code, result }
  const lastTest = useRef(null);                  // { code, t }
  const runsBase = useRef(null);                  // 本页第一次发记录前已有的 runs（刷新后接着加）

  // P6 双起始代码：选择记在 localStorage（键与 PyRunner 的草稿键同源，课堂重置时一并清）
  const comp = useComponent('sandbox');
  const keyArgs = { lessonId: comp.lesson?.id ?? null, classEpoch: comp.classEpoch, name: comp.me?.name, stageId: id };
  const dKey = draftKey(keyArgs);
  const sKey = starterKey(keyArgs);
  const keysRef = useRef({ dKey, sKey });
  keysRef.current = { dKey, sKey };
  const starters = Array.isArray(options?.starters) && options.starters.length >= 2 ? options.starters : null;
  const recordLabel = myData?.starterLabel;
  const initialPick = useMemo(() => {
    if (!starters) return null;
    const known = (l) => typeof l === 'string' && starters.some((x) => x.label === l);
    const stored = readStarter(sKey);
    if (stored === STARTER_PENDING) return null;   // 换过起点、还没选
    if (known(stored)) return { label: stored };
    if (known(recordLabel)) return { label: recordLabel };
    return typeof readDraft(dKey)?.code === 'string' ? { label: null } : null;   // 有草稿没记选择：不再问
  }, [starters, sKey, dKey, recordLabel]);
  const [pick, setPick] = useState(undefined);   // undefined 跟随 initialPick；{ label } 本页选定；null 换起点后回到选择页
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [clearN, setClearN] = useState(0);
  useEffect(() => {
    if (clearN === 0) return;
    clearDraft(keysRef.current.dKey);
    writeStarter(keysRef.current.sKey, STARTER_PENDING);
  }, [clearN]);
  const py = usePython();
  const running = py.status === 'running' || py.status === 'waiting-input';
  const genRef = useRef(0);   // 换起点世代：每换一次 +1
  const gen = genRef.current;
  const current = pick === undefined ? initialPick : pick;
  const picking = !!starters && !readOnly && current == null;
  const chosenLabel = starters && current?.label ? current.label : null;
  const chosenCode = chosenLabel ? starters.find((x) => x.label === chosenLabel)?.code : undefined;
  const baseCode = typeof chosenCode === 'string' ? chosenCode : sandbox?.starter ?? '';

  const code = draft ?? baseCode;
  const codeRef = useRef(code);
  codeRef.current = code;

  if (!options) return <Page template="split" />;

  const withLabel = (rec) => (chosenLabel ? { ...rec, starterLabel: chosenLabel } : rec);
  const submit = (run, tests, src, runs) => {
    if (!isLive) return;
    if (runsBase.current == null) runsBase.current = Number(myData?.runs) || 0;
    send('student:code-submit', withLabel(buildRecord(run, { code: src, tests, runs: runsBase.current + runs })));
  };
  const onResult = (result, info) => {
    if (gen !== genRef.current) return;   // B1：换起点之前那次运行的结果
    const src = codeRef.current;
    lastRun.current = { code: src, result };
    if (result?.interrupted && !result.error) return;
    const t = lastTest.current && lastTest.current.code === src ? lastTest.current.t : null;
    submit(result, t, src, info?.runs ?? 0);
  };
  const onTest = (t, info) => {
    if (gen !== genRef.current) return;
    if (!t || t.interrupted) return;
    const src = codeRef.current;
    lastTest.current = { code: src, t };
    const run = lastRun.current && lastRun.current.code === src ? lastRun.current.result : { stdout: t.stdout, ms: t.ms };
    submit(run, t, src, info?.runs ?? 0);
  };
  const onRestore = ({ code: ranCode, result }) => {
    if (result.kind === 'test') lastTest.current = { code: ranCode, t: { ...result.tests, stdout: result.stdout, ms: result.ms } };
    else lastRun.current = { code: ranCode, result };
  };
  const prepareFinal = () => withLabel(finalRecord({
    code: codeRef.current, run: lastRun.current?.result ?? null, runCode: lastRun.current?.code, test: lastTest.current, myData,
  }));
  const submitFinal = (payload) => {
    if (!isLive || !payload) return;
    send('student:code-final', payload);
  };
  const finalProps = { finalAt: myData?.finalAt ?? null, prepare: prepareFinal, onConfirm: submitFinal, hideButton: !isLive || readOnly };
  const toggle = (i) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

  const choose = (label) => {
    writeStarter(sKey, label);
    lastRun.current = null;
    lastTest.current = null;
    setDraft(null);
    setPick({ label });
  };
  const switchStarter = () => {
    genRef.current += 1;
    if (running) py.stop();
    setConfirmSwitch(false);
    lastRun.current = null;
    lastTest.current = null;
    setDraft(null);
    setPick(null);
    setClearN((n) => n + 1);
  };

  const reviewing = !isLive && !readOnly;
  const requirements = options.requirements ?? [];
  const t = myData?.tests;
  let status = null;
  if (myData?.submittedAt != null) {
    const tone = t ? (passedAll(t) ? 'good' : 'warn') : (myData.error ? 'warn' : 'good');
    status = (
      <Chip tone={tone}>
        已记录 {fmtTime(myData.submittedAt)}{t ? ` · 测试 ${t.passed} / ${t.total}` : ''}{!t && myData.error ? ' · 有报错' : ''}
      </Chip>
    );
  }

  return (
    <Page template="split" ratio="3:1" side="left" resizable sideLabel="题目" title={stage?.label}>
      <Page.Side>
        <div style={noShrink}>
          <Tile title={narrow ? undefined : '题目'}>
            <Stack gap={3}>
              <div data-testid="code-prompt">
                {paragraphs(options.prompt).map((p, i) => (
                  <p key={i} style={{ margin: '0 0 var(--sp-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{p}</p>
                ))}
              </div>
              <TaskList items={requirements} note="要求（自己检查，勾选不会上交）" checked={checked} onToggle={toggle} testId="code-requirements" />
              {!narrow && <FinalSubmit {...finalProps} />}
            </Stack>
          </Tile>
        </div>
        {typeof classData?.solution === 'string' && classData.solution !== '' && (
          <div style={noShrink}>
            <SolutionPanel solution={classData.solution} />
          </div>
        )}
      </Page.Side>
      <Page.Main>
        {picking ? (
          <StarterPicker starters={starters} onPick={choose} />
        ) : sandbox && id ? (
          <PyRunner
            stageId={id}
            code={code}
            starter={baseCode}
            onChange={setDraft}
            onResult={onResult}
            onTest={onTest}
            onRestore={onRestore}
          />
        ) : (
          <div style={{ color: 'var(--ink-dim)' }}>正在准备运行环境…</div>
        )}
      </Page.Main>
      <Page.Actions>
        {reviewing && <Chip>回看 · 运行不记录</Chip>}
        {status ?? (reviewing ? null : <Chip tone="neutral">运行或测试后自动记录</Chip>)}
        {starters && !picking && isLive && !readOnly && (
          <Btn variant="soft" size="sm" onClick={() => setConfirmSwitch(true)}>换起点</Btn>
        )}
        {narrow && <FinalSubmit {...finalProps} inline />}
        {confirmSwitch && (
          <Overlay variant="dialog" testId="starter-switch-confirm" label="换起点" onDismiss={() => setConfirmSwitch(false)}>
            <Stack gap={4}>
              {running && <div data-testid="starter-switch-running" style={{ fontSize: 'var(--fs-sm)', color: 'var(--warn)', lineHeight: 1.5 }}>程序还在运行，换起点会先停止它</div>}
              <div style={{ fontSize: 'var(--fs-md)', lineHeight: 1.6 }}>换起点会清掉现在写的代码（已保存的记录不受影响）</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--sp-3)' }}>
                <Btn variant="ghost" onClick={() => setConfirmSwitch(false)}>取消</Btn>
                <Btn variant="primary" onClick={switchStarter}>确定换起点</Btn>
              </div>
            </Stack>
          </Overlay>
        )}
      </Page.Actions>
    </Page>
  );
}
