// code 学生视图：split 模板（Main : Side = 3 : 1；P5：宽屏题目在左、三栏（题目 | 代码 | 输出）可拖宽）。Side 放标题为"题目"的 Tile：题目正文（空行分段）+ 要求清单（本地勾选，自检用，不采集；
// P6：_shared/TaskList，与 data-analysis 的任务清单共用，{ text, hint } 条目下可展开"提示 ▾"）
// "上交最终稿"（_shared/FinalSubmit：确认后发 student:code-final，载荷 = 当前代码 + 最近一次运行结果，代码在那次运行后改过则带 stale）：
// T9b（教师视图与学生页重排规格 §2.4）宽屏放代码框下方工具栏最右（经 PyRunner 的 toolbarEnd），Side 底部不再放；
// 窄屏时"上交最终稿"放 Page.Actions（折叠题目不会把它收掉）；只读（回看 / 镜像）时不放按钮；
// 还在"选一个起点"页（没有 PyRunner）时宽窄屏都不显示上交；
// S22（上课细节收口规格 §4）：状态只在操作条一枚 Chip（data-testid="final-status"，时间 HH:MM）：没有记录"运行或测试后自动保存"；
// 有记录"已自动保存 HH:MM · 测试 p / t | · 有报错"；已上交"已上交 HH:MM"（上交后又运行过：" · 之后又运行过"，warn）。
// 按钮三态由 FinalSubmit 画，dirty = 已上交且"上交时的代码"与当前代码不同：上交时的代码取本页 ref（submitFinal 时记下；推回来的
// final 是摘要、没有 code），没有再取 final.code；两者都没有（刷新后 final 是摘要）按没改过，由 Chip"之后又运行过"兜底。
// P5 回看（代码段布局与回看规格 §6）：原语缺省 reviewInteractive，回看段能滚动、勾选、编辑、运行、测试，但不发记录、不能上交；
// 操作条第一个 Chip 为"回看 · 运行不记录"（镜像只读时不显示），已有记录时状态 Chip 仍在后面。
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
// P7（教师现场演示规格 §5）：班级记录有老师下发的代码（perClass.pushedCode）且本段是当前段（isLive && !readOnly）、这次下发还没采用 →
// 操作条"老师发来一份代码"芯片 +"看一看"（_shared/PushedCode）；"换成这份"与"换起点"同样处理：程序在跑先 stop()、世代 +1 丢弃旧回调、
// 编辑器换成下发的代码；多份起点时不改已选的 starterLabel。采用后记录带 fromTeacher: true（"换起点"或选了配置里的起点后不再带）。
// 还在选择页时不给按钮，选择页多一张"老师刚发的"卡：选它 = 用这份代码、starterLabel 记"老师下发"（PUSHED_LABEL）。
// D1（学生输入自动保存规格 §2.4）：要求勾选 useDraft('checked', [])；代码除 PyRunner 的本地草稿外，另用 useDraft('code', null, { local: false })
// 只走服务端层（换设备 / 清站点数据也能回填）。起始代码取值链：本地 sandbox 草稿（PyRunner 挂载时交回）→ 服务端 code 草稿 →
// myData.final?.code ?? myData.code → 起点（starter）；PyRunner onChange 同时写服务端草稿（≤ 20000 字）；换起点 / 选起点后不再回落到旧代码。
// T9a 教师演示模式（教师视图与学生页重排规格 §2.2；useStudentStage().demo）：Side 题目与要求照常（勾选本地）、已公布的参考答案照常；
// Main 为 _shared/DemoTools 的 <DemoRunner>（<PyRunner role="teacher">，代码存本地演示记录，工具栏右端：起点下拉 + 载入起始代码 /
// 载入参考答案 / 下发给学生 / 已下发 HH:MM · 撤回）；没有选择页、"上交最终稿"、"换起点"、"老师发来一份代码"，操作条不放东西。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudentStage, useComponent, useNarrow, useDraft, Btn, Chip, Overlay, Page, Stack, Tile } from '#kernel/client/index.js';
import { STARTER_PENDING, clearDraft, draftKey, readDraft, readStarter, starterKey, writeStarter } from '#components/sandbox/client/ui/draftStorage.js';
import { PyRunner, buildRecord, usePython } from '@components/sandbox/index.js';
import FinalSubmit, { finalRecord, fmtHM } from '../_shared/FinalSubmit.jsx';
import SolutionPanel from '../_shared/SolutionPanel.jsx';
import TaskList from '../_shared/TaskList.jsx';
import StarterPicker from './StarterPicker.jsx';
import { PushedCodeOffer, usePushedCode } from '../_shared/PushedCode.jsx';
import { PUSHED_LABEL } from '../_shared/pushCode.js';
import DemoRunner from '../_shared/DemoTools.jsx';

const paragraphs = (text) => String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const CODE_DRAFT_MAX = 20000;   // 服务端代码草稿上限（字）
const passedAll = (t) => !!t && t.total > 0 && t.failed + t.errors === 0;

// Side 里的 Tile 按内容高、不被压缩（内容长时 Side 整体滚动）
const noShrink = { flexShrink: 0, display: 'flex', flexDirection: 'column' };

export default function Student({ stageId } = {}) {
  const { stage, options, isLive, readOnly, myData, classData, send, demo } = useStudentStage(stageId);
  const narrow = useNarrow();
  const id = stageId ?? stage?.id;
  const sandbox = stage?.sandbox ?? null;
  const [draft, setDraft] = useState(null);      // null = 本页还没改过，按取值链
  const [serverCode, setServerCode, { clear: clearServerCode }] = useDraft('code', null, { stageId: id, local: false });
  const [fallback, setFallback] = useState(true);   // false：换过 / 选过起点，不再回落到服务端草稿与记录里的代码
  const [checkedRaw, setCheckedList] = useDraft('checked', [], { stageId: id });
  const checked = useMemo(() => new Set(Array.isArray(checkedRaw) ? checkedRaw.filter((i) => Number.isInteger(i)) : []), [checkedRaw]);
  const lastRun = useRef(null);                   // { code, result }
  const lastFinalCode = useRef(null);             // S22a：本页最近一次上交 { id, code }（推回来的 final 可能是摘要；外壳换段不换实例，只认本段 id）
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
    const known = (l) => typeof l === 'string' && (l === PUSHED_LABEL || starters.some((x) => x.label === l));
    const stored = readStarter(sKey);
    if (stored === STARTER_PENDING) return null;   // 换过起点、还没选
    if (known(stored)) return { label: stored };
    if (known(recordLabel)) return { label: recordLabel };
    // 有草稿（本地或服务端）没记选择：不再问
    return typeof readDraft(dKey)?.code === 'string' || typeof serverCode === 'string' ? { label: null } : null;
  }, [starters, sKey, dKey, recordLabel]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState(undefined);   // undefined 跟随 initialPick；{ label } 本页选定；null 换起点后回到选择页
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [clearN, setClearN] = useState(0);
  useEffect(() => {
    if (clearN === 0) return;
    clearDraft(keysRef.current.dKey);
    writeStarter(keysRef.current.sKey, STARTER_PENDING);
  }, [clearN]);
  const pushedCode = usePushedCode({ classData, isLive, readOnly, keyArgs });
  const py = usePython();
  const running = py.status === 'running' || py.status === 'waiting-input';
  const genRef = useRef(0);   // 换起点世代：每换一次 +1
  const gen = genRef.current;
  const current = pick === undefined ? initialPick : pick;
  const picking = !!starters && !readOnly && !demo && current == null;
  const chosenLabel = starters && current?.label ? current.label : null;
  const chosenCode = chosenLabel ? starters.find((x) => x.label === chosenLabel)?.code : undefined;
  const baseCode = typeof chosenCode === 'string' ? chosenCode : sandbox?.starter ?? '';

  const recordCode = typeof myData?.final?.code === 'string' ? myData.final.code : (typeof myData?.code === 'string' ? myData.code : null);
  // 多份起点时，记录里的代码只在它的起点就是现在选的起点时才回落（选了新起点后刷新不回到旧起点的代码）
  const recordFits = !starters || (chosenLabel != null && myData?.starterLabel === chosenLabel);
  const restoredCode = fallback ? (typeof serverCode === 'string' ? serverCode : (recordFits ? recordCode : null)) : null;
  const code = draft ?? restoredCode ?? baseCode;
  const codeRef = useRef(code);
  codeRef.current = code;

  if (!options) return <Page template="split" />;

  const withLabel = (rec) => (rec ? {
    ...rec,
    ...(chosenLabel ? { starterLabel: chosenLabel } : {}),
    ...(pushedCode.fromTeacher ? { fromTeacher: true } : {}),
  } : rec);
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
    lastFinalCode.current = typeof payload.code === 'string' ? { id, code: payload.code } : null;
    send('student:code-final', payload);
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

  const choose = (label) => {
    writeStarter(sKey, label);
    lastRun.current = null;
    lastTest.current = null;
    setDraft(null);
    setFallback(false);
    clearServerCode();
    setPick({ label });
    pushedCode.setFromTeacher(false);
  };
  const switchStarter = () => {
    genRef.current += 1;
    if (running) py.stop();
    setConfirmSwitch(false);
    lastRun.current = null;
    lastTest.current = null;
    setDraft(null);
    setFallback(false);
    clearServerCode();
    setPick(null);
    setClearN((n) => n + 1);
    pushedCode.setFromTeacher(false);
  };
  // P7：换成老师下发的代码（与换起点同样先停、丢弃旧回调；不改已选的起点）
  const adoptPushed = (p) => {
    genRef.current += 1;
    if (running) py.stop();
    lastRun.current = null;
    lastTest.current = null;
    onCodeChange(p.code);
    pushedCode.markAdopted();
  };
  // P7：选择页选"老师刚发的"
  const choosePushed = () => {
    const p = pushedCode.pushed;
    if (!p) return;
    writeStarter(sKey, PUSHED_LABEL);
    lastRun.current = null;
    lastTest.current = null;
    onCodeChange(p.code);
    setPick({ label: PUSHED_LABEL });
    pushedCode.markAdopted();
  };

  const reviewing = !isLive && !readOnly;
  const requirements = options.requirements ?? [];
  const t = myData?.tests;
  let status = null;
  if (finalAt != null) {
    const ranAfter = myData?.submittedAt != null && myData.submittedAt > finalAt;
    status = <Chip tone={ranAfter ? 'warn' : 'good'} data-testid="final-status">{`已上交 ${fmtHM(finalAt)}${ranAfter ? ' · 之后又运行过' : ''}`}</Chip>;
  } else if (myData?.submittedAt != null) {
    const tone = t ? (passedAll(t) ? 'good' : 'warn') : (myData.error ? 'warn' : 'good');
    status = (
      <Chip tone={tone} data-testid="final-status">
        {`已自动保存 ${fmtHM(myData.submittedAt)}${t ? ` · 测试 ${t.passed} / ${t.total}` : ''}${!t && myData.error ? ' · 有报错' : ''}`}
      </Chip>
    );
  }

  const side = (
    <>
      <div style={noShrink}>
        <Tile title={narrow ? undefined : '题目'}>
          <Stack gap={3}>
            <div data-testid="code-prompt">
              {paragraphs(options.prompt).map((p, i) => (
                <p key={i} style={{ margin: '0 0 var(--sp-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{p}</p>
              ))}
            </div>
            <TaskList items={requirements} note="要求（自己检查，勾选不会上交）" checked={checked} onToggle={toggle} testId="code-requirements" />
          </Stack>
        </Tile>
      </div>
      {typeof classData?.solution === 'string' && classData.solution !== '' && (
        <div style={noShrink}>
          <SolutionPanel solution={classData.solution} />
        </div>
      )}
    </>
  );

  if (demo) {
    // 演示模式：起点是 options.starters（≥ 2 份）或本段 starter
    const demoStarters = starters ?? [{ label: '起始代码', code: options.starter ?? sandbox?.starter ?? '' }];
    return (
      <Page template="split" ratio="3:1" side="left" resizable sideLabel="题目" title={stage?.label}>
        <Page.Side>{side}</Page.Side>
        <Page.Main>
          {sandbox && id
            ? <DemoRunner stageId={id} starters={demoStarters} solution={options.solution} />
            : <div style={{ color: 'var(--ink-dim)' }}>正在准备运行环境…</div>}
        </Page.Main>
      </Page>
    );
  }

  return (
    <Page template="split" ratio="3:1" side="left" resizable sideLabel="题目" title={stage?.label}>
      <Page.Side>{side}</Page.Side>
      <Page.Main>
        {picking ? (
          <StarterPicker
            starters={starters}
            onPick={choose}
            pushed={isLive && pushedCode.pushed ? pushedCode.pushed.code : undefined}
            onPickPushed={choosePushed}
          />
        ) : sandbox && id ? (
          <PyRunner
            stageId={id}
            code={code}
            starter={baseCode}
            onChange={onCodeChange}
            onResult={onResult}
            onTest={onTest}
            onRestore={onRestore}
            toolbarEnd={narrow || hideFinal ? undefined : <FinalSubmit {...finalProps} />}
          />
        ) : (
          <div style={{ color: 'var(--ink-dim)' }}>正在准备运行环境…</div>
        )}
      </Page.Main>
      <Page.Actions>
        {reviewing && <Chip>回看 · 运行不记录</Chip>}
        {status ?? (reviewing ? null : <Chip tone="neutral" data-testid="final-status">运行或测试后自动保存</Chip>)}
        {!picking && <PushedCodeOffer offer={pushedCode.offer} running={running} onAdopt={adoptPushed} />}
        {starters && !picking && isLive && !readOnly && (
          <Btn variant="soft" size="sm" onClick={() => setConfirmSwitch(true)}>换起点</Btn>
        )}
        {narrow && !picking && <FinalSubmit {...finalProps} />}
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
