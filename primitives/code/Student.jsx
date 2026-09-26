// code 学生视图：split 模板（Main : Side = 3 : 1）。Side 放标题为"题目"的 Tile：题目正文（空行分段）+ 要求清单（本地勾选，自检用，不采集）
// + 底部"上交最终稿"（_shared/FinalSubmit：确认后发 student:code-final，载荷 = 当前代码 + 最近一次运行结果，代码在那次运行后改过则带 stale）；
// 窄屏时"上交最终稿"与状态放 Page.Actions（折叠题目不会把它收掉）；只读（回看 / 镜像）时只留状态行；
// Main 放 sandbox 的 <PyRunner>（运行 / 停止 / 测试；代码 / 输出小标题）。每次运行或测试结束自动用 buildRecord 发 student:code-submit，
// 以最后一次为准（自动记录）。测试结果只对测试时的代码有效：改了代码再运行，记录里的 tests 为 null。
// sandbox 配置（starter / tests / files / packages）来自服务端下发的 stage.sandbox；PyRunner 自己读它，只读态（镜像）也由它处理。
// 窄屏时 Side 在上、可折叠（Page 提供"题目 ▾"一行），Tile 不再重复标题。
import { useRef, useState } from 'react';
import { useStudentStage, useNarrow, Chip, Page, Stack, Tile } from '#kernel/client/index.js';
import { PyRunner, buildRecord } from '@components/sandbox/index.js';
import FinalSubmit, { finalRecord } from '../_shared/FinalSubmit.jsx';

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
const paragraphs = (text) => String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const passedAll = (t) => !!t && t.total > 0 && t.failed + t.errors === 0;

const checkRow = { display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start', cursor: 'pointer', lineHeight: 1.5 };
// Side 里的 Tile 按内容高、不被压缩（内容长时 Side 整体滚动）
const noShrink = { flexShrink: 0, display: 'flex', flexDirection: 'column' };

export default function Student({ stageId } = {}) {
  const { stage, options, isLive, readOnly, myData, send } = useStudentStage(stageId);
  const narrow = useNarrow();
  const id = stageId ?? stage?.id;
  const sandbox = stage?.sandbox ?? null;
  const [draft, setDraft] = useState(null);      // null = 还没改过，用 starter
  const [checked, setChecked] = useState(() => new Set());
  const lastRun = useRef(null);                   // { code, result }
  const lastTest = useRef(null);                  // { code, t }
  const runsBase = useRef(null);                  // 本页第一次发记录前已有的 runs（刷新后接着加）
  const code = draft ?? sandbox?.starter ?? '';
  const codeRef = useRef(code);
  codeRef.current = code;

  if (!options) return <Page template="split" />;

  const submit = (run, tests, src, runs) => {
    if (!isLive) return;
    if (runsBase.current == null) runsBase.current = Number(myData?.runs) || 0;
    send('student:code-submit', buildRecord(run, { code: src, tests, runs: runsBase.current + runs }));
  };
  const onResult = (result, info) => {
    const src = codeRef.current;
    lastRun.current = { code: src, result };
    if (result?.interrupted && !result.error) return;
    const t = lastTest.current && lastTest.current.code === src ? lastTest.current.t : null;
    submit(result, t, src, info?.runs ?? 0);
  };
  const onTest = (t, info) => {
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
  const prepareFinal = () => finalRecord({
    code: codeRef.current, run: lastRun.current?.result ?? null, runCode: lastRun.current?.code, test: lastTest.current, myData,
  });
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
    <Page template="split" ratio="3:1" sideLabel="题目" title={stage?.label}>
      <Page.Side>
        <div style={noShrink}>
          <Tile title={narrow ? undefined : '题目'}>
            <Stack gap={3}>
              <div data-testid="code-prompt">
                {paragraphs(options.prompt).map((p, i) => (
                  <p key={i} style={{ margin: '0 0 var(--sp-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{p}</p>
                ))}
              </div>
              {requirements.length > 0 && (
                <Stack gap={2} data-testid="code-requirements">
                  <div style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-sm)' }}>要求（自己检查，勾选不会上交）</div>
                  {requirements.map((r, i) => (
                    <label key={i} style={checkRow}>
                      <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} aria-label={r} />
                      <span>{r}</span>
                    </label>
                  ))}
                </Stack>
              )}
              {!narrow && <FinalSubmit {...finalProps} />}
            </Stack>
          </Tile>
        </div>
      </Page.Side>
      <Page.Main>
        {sandbox && id ? (
          <PyRunner
            stageId={id}
            code={code}
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
        {status ?? <Chip tone="neutral">运行或测试后自动记录</Chip>}
        {narrow && <FinalSubmit {...finalProps} inline />}
      </Page.Actions>
    </Page>
  );
}
