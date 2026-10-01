// 教师课前页：名单卡（在线 / 已认领离线 / 未认领）、释放绑定、导入名单、清空名单、二维码、N/M、进入课堂、重置课堂
// lesson.rosterDefault（classroom:state.rosterDefault）只决定默认展开导入卡（'roster'）还是显示自由起名标记（'free'）；
// 已有名单（rosterMode）时总是展开，便于清空；教师可随时手动展开 / 收起。
// 选择文件后直接读文本并发送 teacher:import-roster { text }；收到 admin-ok { action:'import-roster' } 后清空文本框。
// v0.7（界面整理规格 §4）：<Page template="split">（= <Split ratio="3:2">）：左"已登录"用 <Tiles> 显示名字，
// 右 <Stack>：二维码（地址用 /api/lan 的局域网 IP，请求带教师 token；无则回退 location.origin）、进入课堂、名单导入、重置课堂
// T9a（教师视图与学生页重排规格 §2.1）：二维码之下、进入课堂之前是组件状态行（teacherPrelogin 槽位：Python 就绪、AI 助手未配置）
import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { coreTeacherStore } from '../stores/coreTeacherStore.js';
import { useLanURL } from '../hooks/useServerURL.js';
import Btn from '../ui/Btn.jsx';
import Chip from '../ui/Chip.jsx';
import ConfirmAdvanceBtn from '../ui/ConfirmAdvanceBtn.jsx';
import Page from '../layout/Page.jsx';
import Tiles from '../layout/Tiles.jsx';
import Stack from '../layout/Stack.jsx';
import Row from '../layout/Row.jsx';
import Overlay, { BigName } from './Overlay.jsx';
import { TeacherPreloginRows } from './ComponentSlots.jsx';

// U4：名字格比里面的 ×（--control-h）高一个 --sp-1，× 不加边框，不再贴边显挤
const nameChip = {
  minHeight: 'calc(var(--control-h) + var(--sp-1))',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  minWidth: 0,
};

export default function TeacherPrelogin() {
  const roster = coreTeacherStore((s) => s.roster);
  const counts = coreTeacherStore((s) => s.counts);
  const advance = coreTeacherStore((s) => s.advance);
  const viewedStageIndex = coreTeacherStore((s) => s.viewedStageIndex);
  const stageIndex = coreTeacherStore((s) => s.stageIndex);
  const joined = coreTeacherStore((s) => s.joined);
  const rosterMode = coreTeacherStore((s) => s.rosterMode);
  const rosterNames = coreTeacherStore((s) => s.rosterNames);
  const claimedNames = coreTeacherStore((s) => s.claimedNames);
  const releaseBinding = coreTeacherStore((s) => s.releaseBinding);
  const importRoster = coreTeacherStore((s) => s.importRoster);
  const clearRoster = coreTeacherStore((s) => s.clearRoster);
  const resetClassroom = coreTeacherStore((s) => s.resetClassroom);
  const adminError = coreTeacherStore((s) => s.adminError);
  const rosterDefault = coreTeacherStore((s) => s.lesson.rosterDefault);
  const lastAdminOk = coreTeacherStore((s) => s.lastAdminOk);

  const token = coreTeacherStore((s) => s.token);
  const { url: serverURL, candidates: lanCandidates, pick: pickLan } = useLanURL({ token });
  const [confirmRelease, setConfirmRelease] = useState(null);
  const [importText, setImportText] = useState('');
  const [importOpenManual, setImportOpenManual] = useState(null);
  const importOpen = importOpenManual ?? (rosterMode || rosterDefault !== 'free');

  useEffect(() => {
    if (lastAdminOk && lastAdminOk.action === 'import-roster') setImportText('');
  }, [lastAdminOk]);

  const isReviewing = viewedStageIndex !== stageIndex;
  const onlineCount = counts && Number.isFinite(counts.online)
    ? counts.online
    : roster.filter((r) => r.connected !== false).length;
  const onlineRoster = roster.filter((s) => s.connected !== false);
  const claimedSet = useMemo(() => new Set(claimedNames || []), [claimedNames]);
  const rosterByName = useMemo(() => {
    const m = new Map();
    for (const s of roster) m.set(s.name, s);
    return m;
  }, [roster]);
  const unclaimed = Math.max(0, (rosterNames || []).filter((n) => !claimedSet.has(n)).length);

  const onFile = async (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = typeof file.text === 'function'
        ? await file.text()
        : await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(r.error);
          r.readAsText(file);
        });
      setImportText(text);
      if (text.trim()) importRoster(text);
    } catch (_) {
      setImportText('');
    }
    input.value = '';
  };

  const title = (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--sp-3)' }}>
      <span>已登录</span>
      <span data-testid="online-count" style={{ color: 'var(--accent)', fontFamily: 'ui-monospace, monospace' }}>
        {rosterMode ? `${onlineCount} / ${rosterNames.length}` : `${onlineCount}`}
      </span>
    </span>
  );
  const hint = (
    <Row gap={2}>
      {rosterMode && unclaimed > 0 && <Chip tone="warn">未到 {unclaimed}</Chip>}
      <Chip tone="accent">
        <span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--accent)', animation: 'pulse 1.4s infinite' }} />
        实时
      </Chip>
    </Row>
  );

  return (
    <Page template="split" narrowOrder="main-first" title={title} hint={hint}>
      <Page.Main>
        <Tiles min="160px" gap={2}>
          {rosterMode
            ? rosterNames.map((nm) => {
              const s = rosterByName.get(nm);
              const isClaimed = claimedSet.has(nm);
              const isOnline = !!s && s.connected !== false;
              return (
                <div
                  key={nm}
                  data-testid={`roster-card-${nm}`}
                  data-state={isOnline ? 'online' : isClaimed ? 'offline' : 'unclaimed'}
                  style={{
                    ...nameChip,
                    background: isOnline || isClaimed ? 'var(--surface-alt)' : 'transparent',
                    border: isOnline || isClaimed ? '1px solid var(--border)' : '1px dashed var(--border)',
                    color: isOnline ? 'var(--ink)' : 'var(--ink-dim)',
                    opacity: isOnline ? 1 : isClaimed ? 0.7 : 0.55,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nm}</span>
                  {isClaimed && (
                    <button
                      type="button"
                      data-testid={`release-${nm}`}
                      aria-label={`释放 ${nm}`}
                      onClick={() => setConfirmRelease(nm)}
                      style={{
                        width: 'var(--control-h)', height: 'var(--control-h)', borderRadius: 'var(--radius-sm)', flexShrink: 0,
                        background: 'transparent', color: 'var(--bad)',
                        border: 'none',
                        fontSize: 'var(--fs-sm)', fontWeight: 700, lineHeight: 1,
                        cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })
            : onlineRoster.map((s) => (
              <div key={s.name} style={{ ...nameChip, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                {s.name}
              </div>
            ))}
        </Tiles>
      </Page.Main>

      <Page.Side>
        <Stack gap={3}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-2)' }}>
            {serverURL ? (
              <QRCodeSVG value={serverURL} size={200} level="M" style={{ width: 'min(200px, 100%)', height: 'auto', background: 'var(--surface)', padding: 8, borderRadius: 8 }} />
            ) : (
              <div style={{ width: 'min(200px, 100%)', aspectRatio: '1', background: 'var(--surface)', borderRadius: 12 }} />
            )}
            {serverURL && (
              <div
                data-testid="server-url"
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 'var(--fs-lg)',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  overflowWrap: 'anywhere',
                  textAlign: 'center',
                }}
              >
                {serverURL}
              </div>
            )}
            {lanCandidates.length > 1 && (
              <div data-testid="lan-options" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--sp-1)' }}>
                {lanCandidates.map((u) => {
                  const on = u === serverURL;
                  const host = u.replace(/^[a-z]+:\/\//, '').replace(/:\d+$/, '');
                  return (
                    <button
                      key={u}
                      type="button"
                      data-testid={`lan-option-${host}`}
                      aria-pressed={on}
                      onClick={() => pickLan(u)}
                      style={{
                        height: 'var(--control-h)',
                        padding: '0 var(--sp-2)',
                        borderRadius: 999,
                        border: on ? '1.5px solid var(--brand)' : '1px solid var(--border-strong)',
                        background: on ? 'var(--brand-soft)' : 'var(--surface)',
                        color: on ? 'var(--brand)' : 'var(--ink-soft)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-xs)',
                        cursor: 'pointer',
                      }}
                    >
                      {host}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <TeacherPreloginRows />

          {!isReviewing && (
            <Btn
              data-testid="enter-class"
              variant="primary"
              size="lg"
              onClick={() => advance(false)}
              disabled={!joined}
              style={{ width: '100%' }}
            >
              进入课堂 →
            </Btn>
          )}

          {!importOpen && (
            <Row gap={2}>
              <Chip tone="brand">
                <span data-testid="roster-default-free">自由起名</span>
              </Chip>
              <Btn data-testid="roster-import-open" variant="ghost" onClick={() => setImportOpenManual(true)}>
                导入名单
              </Btn>
            </Row>
          )}

          {importOpen && (
            <div data-testid="roster-import-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <textarea
                data-testid="roster-import-text"
                aria-label="名单"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'inherit',
                  fontSize: 'var(--fs-sm)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  resize: 'vertical',
                }}
              />
              <Row gap={2}>
                <label style={{
                  display: 'inline-flex', alignItems: 'center', height: 'var(--control-h)', padding: '0 0.875rem',
                  border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
                  fontSize: 'var(--fs-sm)', cursor: 'pointer', color: 'var(--ink)',
                }}>
                  选择文件
                  <input
                    data-testid="roster-import-file"
                    type="file"
                    accept=".txt,.csv,text/plain,text/csv"
                    onChange={onFile}
                    style={{ display: 'none' }}
                  />
                </label>
                <Btn
                  data-testid="roster-import-btn"
                  disabled={!importText.trim()}
                  onClick={() => importRoster(importText)}
                >
                  导入名单
                </Btn>
                {rosterMode && (
                  <ConfirmAdvanceBtn
                    data-testid="clear-roster"
                    variant="ghost"
                    confirmVariant="danger"
                    onAdvance={clearRoster}
                  >
                    清空名单
                  </ConfirmAdvanceBtn>
                )}
              </Row>
            </div>
          )}

          {adminError && (
            <div role="alert" data-testid="admin-error" style={{ fontSize: 'var(--fs-sm)', color: 'var(--bad)' }}>
              {adminError.message || adminError.action}
            </div>
          )}

          <ConfirmAdvanceBtn
            data-testid="reset-classroom"
            variant="ghost"
            confirmVariant="danger"
            onAdvance={resetClassroom}
            style={{ width: '100%' }}
          >
            重置课堂
          </ConfirmAdvanceBtn>
        </Stack>
      </Page.Side>

      {confirmRelease && (
        <Overlay testId="release-dialog" onDismiss={() => setConfirmRelease(null)}>
          <BigName>{confirmRelease}</BigName>
          <div style={{ display: 'flex', gap: 12 }}>
            <Btn variant="ghost" size="lg" onClick={() => setConfirmRelease(null)} style={{ flex: 1 }}>
              取消
            </Btn>
            <Btn
              data-testid="release-confirm"
              variant="danger"
              size="lg"
              onClick={() => { releaseBinding(confirmRelease); setConfirmRelease(null); }}
              style={{ flex: 2 }}
            >
              释放绑定
            </Btn>
          </div>
        </Overlay>
      )}
    </Page>
  );
}
