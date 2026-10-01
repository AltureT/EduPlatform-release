// 学生登录 / 课前页：名单网格（未认领 / 已认领 / 本人）、二次确认、接管、自由起名、重名结果、切换名字
// v0.7（界面整理规格 §4）：<Shell> + <Page template="split">；名字用 <Tiles min="120px">，每格高 --control-h；
// 去掉固定高度卡片与二维码（学生页不需要二维码）；自由起名的"进入课堂"经 Page.Actions 进操作条
import { useEffect, useMemo, useState } from 'react';
import { coreStudentStore } from '../stores/coreStudentStore.js';
import Btn from '../ui/Btn.jsx';
import Shell from '../layout/Shell.jsx';
import Page from '../layout/Page.jsx';
import Tiles from '../layout/Tiles.jsx';
import Brand from './Brand.jsx';
import Overlay, { BigName } from './Overlay.jsx';

const NAME_MAX = 16;

function Notice({ tone = 'accent', children, testId }) {
  return (
    <div data-testid={testId} style={{
      fontSize: 'var(--fs-sm)', padding: '8px 10px', borderRadius: 6, lineHeight: 1.5,
      color: tone === 'bad' ? 'var(--bad)' : 'var(--accent)',
      background: tone === 'bad' ? 'var(--bad-soft)' : 'var(--accent-soft)',
    }}>{children}</div>
  );
}

// banner：已加入后课前等待期由 StudentApp 传入组件 studentBanner 行（v0.7.1）；未加入时不传
export default function StudentLogin({ banner = null }) {
  const join = coreStudentStore((s) => s.join);
  const switchName = coreStudentStore((s) => s.switchName);
  const requestClaimRelease = coreStudentStore((s) => s.requestClaimRelease);
  const joined = coreStudentStore((s) => s.joined);
  const joinedName = coreStudentStore((s) => s.name);
  const roster = coreStudentStore((s) => s.roster);
  const counts = coreStudentStore((s) => s.counts);
  const resetNotice = coreStudentStore((s) => s.resetNotice);
  const rosterMode = coreStudentStore((s) => s.rosterMode);
  const rosterNames = coreStudentStore((s) => s.rosterNames);
  const claimedNames = coreStudentStore((s) => s.claimedNames);
  const stage = coreStudentStore((s) => s.stage);
  const lesson = coreStudentStore((s) => s.lesson);

  const onlineCount = counts && Number.isFinite(counts.online)
    ? counts.online
    : roster.filter((r) => r.connected !== false).length;

  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [renameNotice, setRenameNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingName, setPendingName] = useState(null);
  const [confirmName, setConfirmName] = useState(null);
  const [reclaimName, setReclaimName] = useState(null);
  const [reclaimError, setReclaimError] = useState('');

  const claimedSet = useMemo(() => new Set(claimedNames || []), [claimedNames]);

  // 二次确认期间该名字被别人认领 → 关闭确认
  useEffect(() => {
    if (confirmName && claimedSet.has(confirmName)) setConfirmName(null);
  }, [confirmName, claimedSet]);

  const doJoin = async (inputName) => {
    if (!inputName) return;
    setSubmitting(true);
    setPendingName(inputName);
    setError('');
    setRenameNotice('');
    if (resetNotice) coreStudentStore.setState({ resetNotice: null });
    let result = await join(inputName);
    // 本设备已绑定别的名字：自动改以绑定的名字进入（同设备重进服务端允许），不让学生卡在登录页
    if (!result.ok && result.boundName && result.boundName !== inputName) {
      const bound = result.boundName;
      result = await join(bound);
      if (result.ok) setRenameNotice(`本设备已登录为「${bound}」，已为你进入`);
    }
    if (!result.ok) {
      setError(result.error || '加入失败');
    } else if (result.renamed && result.finalName !== inputName) {
      setRenameNotice(`「${inputName}」已被使用，你的名字为「${result.finalName}」`);
    }
    setSubmitting(false);
    setPendingName(null);
  };

  const handleJoinFromInput = () => doJoin(name.trim());

  const doReclaim = async () => {
    const target = reclaimName;
    setSubmitting(true);
    setReclaimError('');
    setPendingName(target);
    const release = await requestClaimRelease(target);
    if (!release.ok) {
      setReclaimError(release.error || '释放失败');
      setSubmitting(false);
      setPendingName(null);
      return;
    }
    setReclaimName(null);
    await doJoin(target);
  };

  const isSwitching = !!(confirmName && joined && joinedName && joinedName !== confirmName);

  const nameTile = {
    height: 'var(--control-h)',
    padding: '0 var(--sp-3)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--fs-md)',
    fontWeight: 600,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  };

  // 侧区只在有内容时出现（已登录状态、自由起名输入、提示）；名单模式未登录时只有名字，用 focus
  const hasSide = joined || !rosterMode || !!resetNotice || !!error;

  const title = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', animation: 'pulse 1.4s infinite' }} />
      已登录
      <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--accent)' }}>
        {onlineCount}{rosterMode && rosterNames.length ? ` / ${rosterNames.length}` : ''}
      </span>
    </span>
  );

  return (
    <Shell role="student" testId="student-login" banner={joined ? banner : null} header={<Brand glyph={lesson.glyph} title={lesson.title} size="sm" />}>
      <Page template={hasSide ? 'split' : 'focus'} narrowOrder="main-first" title={title}>
        <Page.Main>
          {rosterMode ? (
            <Tiles min="120px" gap={2}>
              {rosterNames.map((nm) => {
                const mine = joined && nm === joinedName;
                const claimed = claimedSet.has(nm) && !mine;
                const isPending = submitting && pendingName === nm;
                return (
                  <button
                    key={nm}
                    type="button"
                    data-testid={`roster-name-${nm}`}
                    data-state={mine ? 'mine' : claimed ? 'claimed' : 'open'}
                    disabled={submitting || mine}
                    onClick={() => (claimed ? setReclaimName(nm) : setConfirmName(nm))}
                    style={{
                      ...nameTile,
                      background: mine ? 'var(--accent)' : claimed ? 'var(--surface-alt)' : 'var(--surface)',
                      color: mine ? 'var(--surface)' : claimed ? 'var(--ink-dim)' : 'var(--ink)',
                      border: mine ? '1.5px solid var(--accent)' : claimed ? '1px dashed var(--border)' : '1.5px solid var(--border-strong)',
                      cursor: submitting ? 'not-allowed' : mine ? 'default' : 'pointer',
                      opacity: claimed ? 0.55 : 1,
                    }}
                  >
                    {isPending ? '…' : claimed ? `${nm} ✓` : nm}
                  </button>
                );
              })}
            </Tiles>
          ) : (
            <Tiles min="120px" gap={2}>
              {roster.map((s) => {
                const mine = s.name === joinedName;
                return (
                  <div key={s.name} style={{
                    ...nameTile,
                    display: 'flex',
                    alignItems: 'center',
                    background: mine ? 'var(--accent)' : 'var(--surface-alt)',
                    color: mine ? 'var(--surface)' : 'var(--ink)',
                    border: mine ? 'none' : '1px solid var(--border)',
                    fontWeight: mine ? 600 : 500,
                    opacity: s.connected === false ? 0.45 : 1,
                  }}>
                    {s.name}
                  </div>
                );
              })}
            </Tiles>
          )}
        </Page.Main>

        {hasSide && <Page.Side>
          {joined ? (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14, background: 'var(--good)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--surface)', fontSize: 24, fontWeight: 700,
              }}>✓</div>
              <div data-testid="joined-name" style={{ fontSize: 'var(--fs-xl)', fontWeight: 600 }}>{joinedName}</div>
              {renameNotice && <Notice testId="rename-notice">{renameNotice}</Notice>}
              {stage === 'prelogin' && (
                <Btn variant="ghost" onClick={() => switchName()}>
                  切换名字
                </Btn>
              )}
            </div>
          ) : rosterMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {resetNotice && !error && <Notice>{resetNotice}</Notice>}
              {error && <Notice tone="bad">{error}</Notice>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoinFromInput(); }}
                placeholder="姓名"
                maxLength={NAME_MAX}
                aria-label="姓名"
                style={{
                  height: 48,
                  padding: '0 var(--sp-3)',
                  border: '2px solid var(--accent)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                  fontSize: 'var(--fs-lg)',
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  color: 'var(--ink)',
                  width: '100%',
                  outline: 'none',
                }}
              />
              {error && <Notice tone="bad">{error}</Notice>}
              {resetNotice && !error && <Notice>{resetNotice}</Notice>}
            </div>
          )}
        </Page.Side>}

        {!joined && !rosterMode && (
          <Page.Actions>
            <Btn
              data-testid="free-join"
              variant="primary"
              size="lg"
              disabled={!name.trim() || submitting}
              onClick={handleJoinFromInput}
            >
              {submitting ? '…' : '进入课堂 →'}
            </Btn>
          </Page.Actions>
        )}
      </Page>

      {rosterMode && reclaimName && (
        <Overlay testId="reclaim-dialog" onDismiss={() => { if (!submitting) { setReclaimName(null); setReclaimError(''); } }}>
          <div style={{ fontSize: 'var(--fs-lg)', color: 'var(--ink-soft)', fontWeight: 500, marginBottom: 14 }}>
            已被其他设备认领
          </div>
          <BigName>{reclaimName}</BigName>
          {reclaimError && <Notice tone="bad">{reclaimError}</Notice>}
          <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
            <Btn variant="ghost" size="lg" disabled={submitting}
              onClick={() => { setReclaimName(null); setReclaimError(''); }}
              style={{ flex: 1 }}>取消</Btn>
            <Btn data-testid="reclaim-confirm" variant="primary" size="lg" disabled={submitting}
              onClick={doReclaim} style={{ flex: 2 }}>
              {submitting ? '…' : '接管 →'}
            </Btn>
          </div>
        </Overlay>
      )}

      {rosterMode && confirmName && (
        <Overlay testId="confirm-dialog" onDismiss={() => { if (!submitting) setConfirmName(null); }}>
          {isSwitching && (
            <div style={{ fontSize: 'var(--fs-md)', color: 'var(--ink-soft)', marginBottom: 14 }}>
              {joinedName} → {confirmName}
            </div>
          )}
          <BigName>{confirmName}</BigName>
          <div style={{ display: 'flex', gap: 12 }}>
            <Btn variant="ghost" size="lg" disabled={submitting} onClick={() => setConfirmName(null)} style={{ flex: 1 }}>
              取消
            </Btn>
            <Btn
              data-testid="confirm-join"
              variant="primary"
              size="lg"
              disabled={submitting}
              onClick={() => {
                const nm = confirmName;
                setConfirmName(null);
                // 已登录时切换：先释放旧绑定（rejoin 让服务端不回推 reset），紧接着认领新名字
                if (isSwitching) switchName({ rejoin: true });
                doJoin(nm);
              }}
              style={{ flex: 2 }}
            >
              {isSwitching ? '确认切换' : '确认 →'}
            </Btn>
          </div>
        </Overlay>
      )}
    </Shell>
  );
}
