// share 组件客户端：教师侧栏（推荐 / 邀请）、教师全屏层（聚焦 / 互助双面板）、学生顶层（分享提示 / 互助卡片）
// 隐私：学生端只读 data.my.peerHelp（仅 helper 本人有）与 perClass.spotlight（只含姓名）
// 覆盖层（界面整理规格 v0.2.2 §2.3）：一律走内核 Overlay——教师聚焦 / 互助双面板为全屏 panel（fill）。
// 学生端（可选组件规格 v0.3.5 §3.2）：studentBanner 在外壳横幅区放一行（契约 §八：每个组件一行、不超过 --control-h）：
//   分享段：自己被聚焦 → "● 你正在分享给全班"（不可收起）；别人被聚焦 → "正在分享：张三 [收起]"
//     （收起记在切片 slice.spotlightHiddenAt = spotlight.at，重挂载后不再出现，下一次分享重新出现）；
//   互助段：peerHelp 非空 → "帮一下 同学 A [展开]"（展开记在 slice.peerOpenAt = peerHelp.at）；
//   两段同时存在时用" · "合成一行。studentOverlay 只渲染展开后的 panel（匿名镜像），收起 / 点遮罩回到横幅
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useComponent,
  useTeacherStage,
  MirrorProvider,
  StageStudentView,
  Btn,
  Chip,
  Fill,
  Overlay,
  Row,
  Split,
  Stack,
} from '#kernel/client/index.js';

const ID = 'share';
const MAX_RECOMMEND = 5;
const RECOMMEND_MS = 2000;

// ---------- 纯函数 ----------

// §2.5 recommend：roster 含离线学生；组件过滤在线后取前 5。无 recommend 返回 null
export function computeRecommendations(stage, perStudent, roster) {
  if (typeof stage?.recommend !== 'function') return null;
  let list;
  try {
    list = stage.recommend({ perStudent: perStudent ?? {}, roster: roster ?? [] });
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const online = new Set((roster ?? []).filter((s) => s.connected).map((s) => s.name));
  return list
    .filter((x) => x && typeof x.name === 'string' && online.has(x.name))
    .slice(0, MAX_RECOMMEND)
    .map((x) => ({ name: x.name, reason: x.reason }));
}

// perStudent → [{ helper, ...peerHelp }]，按 at 降序（最新在前）
export function latestFirst(perStudent) {
  return Object.entries(perStudent ?? {})
    .filter(([, r]) => r?.peerHelp)
    .map(([helper, r]) => ({ helper, ...r.peerHelp }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

const anonMe = (code) => ({ name: code, enteredStageAt: null, enteredStageIndex: null });

function rosterMe(roster, name) {
  const s = (roster ?? []).find((x) => x.name === name);
  return { name, enteredStageAt: s?.enteredStageAt ?? null, enteredStageIndex: s?.enteredStageIndex ?? null };
}

// ---------- teacherSidebar ----------

export function SidebarView({ stageId, rows, online, hasScore, send }) {
  const [picks, setPicks] = useState({});
  return (
    <Stack gap={3}>
      {rows.length === 0 && <div style={{ color: 'var(--ink-dim)', fontSize: 'var(--fs-sm)' }}>—</div>}
      {rows.map(({ name, reason }) => {
        const pick = picks[name] ?? '';
        const canHelp = hasScore || pick !== '';
        const others = online.filter((n) => n !== name);
        return (
          <div
            key={name}
            data-share-row={name}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--ink)', fontSize: 'var(--fs-md)', fontWeight: 600 }}>{name}</span>
              {reason != null && reason !== '' && (
                <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--fs-xs)' }}>{String(reason)}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Btn variant="primary" onClick={() => send('share:t-invite', { name, stageId })}>
                邀请回答
              </Btn>
              <select
                aria-label="被帮助者"
                value={pick}
                onChange={(e) => setPicks((p) => ({ ...p, [name]: e.target.value }))}
                style={{
                  height: 'var(--control-h)',
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--ink)',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0 6px',
                  fontFamily: 'inherit',
                }}
              >
                {hasScore ? <option value="">自动</option> : <option value="" disabled>被帮助者</option>}
                {others.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <Btn
                variant="soft"
                disabled={!canHelp}
                onClick={() => {
                  const payload = { helper: name, stageId };
                  if (pick !== '') payload.struggling = pick;
                  send('share:t-peer-help', payload);
                }}
              >
                邀请互助
              </Btn>
            </div>
          </div>
        );
      })}
    </Stack>
  );
}

function TeacherSidebar({ stageId, isLive }) {
  const c = useComponent(ID);
  const { stage, roster } = useTeacherStage(stageId);
  const enabled = Boolean(isLive) && c.isEnabledFor(stageId);
  const perStudent = c.stageData(stageId).perStudent;

  // recommend 每 2 s 重算一次；在线过滤每次渲染都做
  const [tick, setTick] = useState(0);
  const hasRecommend = typeof stage?.recommend === 'function';
  useEffect(() => {
    if (!enabled || !hasRecommend) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), RECOMMEND_MS);
    return () => clearInterval(t);
  }, [enabled, hasRecommend]);
  // 依赖只含 tick 等：perStudent / roster 的变化等到下一次 2 s 重算
  const recommended = useMemo(() => computeRecommendations(stage, perStudent, roster), [tick, stage, stageId, enabled]);

  if (!enabled) return null;
  const online = (roster ?? []).filter((s) => s.connected).map((s) => s.name);
  const onlineSet = new Set(online);
  const rows = recommended
    ? recommended.filter((r) => onlineSet.has(r.name))
    : online.map((name) => ({ name }));
  return (
    <SidebarView
      stageId={stageId}
      rows={rows}
      online={online}
      hasScore={typeof stage?.score === 'function'}
      send={c.send}
    />
  );
}

// ---------- teacherOverlay ----------

const headStyle = {
  flex: 1,
  minWidth: 0,
  color: 'var(--ink)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 600,
};

function Spotlight({ spotlight, onClose }) {
  const c = useComponent(ID);
  const { roster } = useTeacherStage(spotlight.stageId);
  const sd = c.stageData(spotlight.stageId);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Overlay variant="panel" fill label={`当前聚焦 · ${spotlight.name}`} testId="share-spotlight" onDismiss={onClose}>
      <Row gap={3} wrap={false}>
        <span style={headStyle}>
          <span style={{ color: 'var(--accent)' }}>●</span> 当前聚焦 · {spotlight.name}
        </span>
        <Btn variant="ghost" aria-label="关闭" onClick={onClose}>✕</Btn>
      </Row>
      <Fill scroll>
        <MirrorProvider
          name={spotlight.name}
          record={sd.perStudent?.[spotlight.name]}
          classData={sd.perClass ?? {}}
          me={rosterMe(roster, spotlight.name)}
        >
          <StageStudentView stageId={spotlight.stageId} />
        </MirrorProvider>
      </Fill>
    </Overlay>
  );
}

function HelperMirror({ helper, stageId }) {
  const c = useComponent(ID);
  const { roster } = useTeacherStage(stageId);
  const sd = c.stageData(stageId);
  return (
    <MirrorProvider name={helper} record={sd.perStudent?.[helper]} classData={sd.perClass ?? {}} me={rosterMe(roster, helper)}>
      <StageStudentView stageId={stageId} />
    </MirrorProvider>
  );
}

function PeerHelpPanels({ groups, onClear }) {
  const [picked, setPicked] = useState(null);
  const current = groups.find((g) => g.helper === picked) ?? groups[0];
  const others = groups.filter((g) => g !== current);
  const main = (
    <div data-share-peer-main style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', minWidth: 0, minHeight: 0, flex: '1 1 0%' }}>
      <Row gap={3} wrap={false}>
        <span style={headStyle}>
          {current.code} ← {current.helper}
        </span>
        <Btn variant="ghost" aria-label="关闭" data-share-peer-close onClick={() => onClear(current.helper)}>✕</Btn>
      </Row>
      <Split gap={3}>
        <Fill scroll>
          <Row gap={2}><Chip tone="neutral">{current.code}</Chip></Row>
          <MirrorProvider name={current.code} record={current.record ?? {}} classData={current.classData ?? {}} me={anonMe(current.code)}>
            <StageStudentView stageId={current.stageId} />
          </MirrorProvider>
        </Fill>
        <Fill scroll>
          <Row gap={2}><Chip tone="brand">{current.helper}</Chip></Row>
          <HelperMirror helper={current.helper} stageId={current.stageId} />
        </Fill>
      </Split>
    </div>
  );
  return (
    <Overlay variant="panel" fill label="互助" testId="share-peer-help">
      {others.length > 0 ? (
        <Split ratio="3:1" gap={6}>
          {main}
          <div
            data-share-peer-list
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-2)',
              minWidth: 0,
              paddingLeft: 'var(--sp-4)',
              borderLeft: '1px solid var(--border)',
            }}
          >
            {others.map((g) => (
              <Row key={g.helper} gap={1} wrap={false}>
                <Btn
                  variant="soft"
                  data-share-peer-pick={g.helper}
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => setPicked(g.helper)}
                >
                  {g.code} ← {g.helper}
                </Btn>
                <Btn variant="ghost" aria-label="关闭" onClick={() => onClear(g.helper)}>✕</Btn>
              </Row>
            ))}
          </div>
        </Split>
      ) : main}
    </Overlay>
  );
}

function TeacherOverlay() {
  const c = useComponent(ID);
  const spotlight = c.data.perClass?.spotlight;
  const groups = latestFirst(c.data.perStudent);
  const { send } = c;
  const onClose = useCallback(() => send('share:t-clear', {}), [send]);
  return (
    <>
      {groups.length > 0 && <PeerHelpPanels groups={groups} onClear={(helper) => send('share:t-peer-help-clear', { helper })} />}
      {spotlight?.name && spotlight?.stageId && <Spotlight spotlight={spotlight} onClose={onClose} />}
    </>
  );
}

// ---------- studentBanner / studentOverlay ----------

// 横幅区的一行：高 --control-h，不挡页面；按钮 soft（无边框）、md（与行同高）
const bannerRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  height: 'var(--control-h)',
  padding: '0 var(--sp-4)',
  color: 'var(--ink)',
  fontSize: 'var(--fs-sm)',
  minWidth: 0,
  overflow: 'hidden',
};
const bannerSeg = { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 0, flex: '0 1 auto' };
const bannerText = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// peerHelp 的展开状态：slice.peerOpenAt === peerHelp.at 时展开（教师再次邀请、at 变化后回到横幅）
function usePeerHelp() {
  const c = useComponent(ID);
  const peerHelp = c.data.my?.peerHelp;
  const active = Boolean(peerHelp?.code && peerHelp?.stageId);
  const stamp = peerHelp?.at ?? peerHelp?.code ?? null;
  const open = active && c.slice?.peerOpenAt != null && c.slice.peerOpenAt === stamp;
  const { setLocal } = c;
  const setOpen = useCallback((v) => setLocal({ peerOpenAt: v ? stamp : null }), [setLocal, stamp]);
  return { c, peerHelp: active ? peerHelp : null, open, setOpen };
}

function StudentBanner() {
  const { c, peerHelp, open, setOpen } = usePeerHelp();
  const spotlight = c.data.perClass?.spotlight;
  const spotStamp = spotlight?.at ?? spotlight?.name ?? null;
  const self = Boolean(spotlight?.name) && spotlight.name === c.me?.name;
  // 别人被聚焦且未收起才显示分享段；自己被聚焦的提示不可收起
  const showSpot = Boolean(spotlight?.name) && (self || c.slice?.spotlightHiddenAt !== spotStamp);
  if (!showSpot && !peerHelp) return null;
  const tone = self ? 'var(--accent-soft)' : showSpot ? 'var(--brand-soft)' : 'var(--good-soft)';
  return (
    <div data-share-banner="" style={{ ...bannerRow, background: tone }}>
      {showSpot && (
        <span data-share-seg={self ? 'spotlight-self' : 'spotlight'} style={bannerSeg}>
          {self ? (
            <span style={bannerText}>
              <span style={{ color: 'var(--accent)' }}>●</span> 你正在分享给全班
            </span>
          ) : (
            <>
              <span style={bannerText}>正在分享：{spotlight.name}</span>
              <Btn variant="soft" onClick={() => c.setLocal({ spotlightHiddenAt: spotStamp })}>收起</Btn>
            </>
          )}
        </span>
      )}
      {showSpot && peerHelp && <span aria-hidden="true" style={{ color: 'var(--ink-dim)' }}>·</span>}
      {peerHelp && (
        <span data-share-seg="peer-help" style={bannerSeg}>
          <span style={{ ...bannerText, fontWeight: 600 }}>帮一下 {peerHelp.code}</span>
          <Btn variant="soft" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '收起' : '展开'}
          </Btn>
        </span>
      )}
    </div>
  );
}

// "帮一下 同学 A" 展开后的 panel：匿名镜像；收起（按钮或点遮罩）回到横幅
function StudentOverlay() {
  const { peerHelp, open, setOpen } = usePeerHelp();
  if (!peerHelp || !open) return null;
  const collapse = () => setOpen(false);
  return (
    <Overlay variant="panel" label={`帮一下 ${peerHelp.code}`} testId="share-peer-card" onDismiss={collapse}>
      <Row gap={3} wrap={false}>
        <span style={{ ...headStyle, fontSize: 'var(--fs-md)' }}>帮一下 {peerHelp.code}</span>
        <Btn variant="ghost" onClick={collapse}>收起</Btn>
      </Row>
      <Fill scroll>
        <div data-share-peer-card style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)' }}>
          <MirrorProvider
            name={peerHelp.code}
            record={peerHelp.record ?? {}}
            classData={peerHelp.classData ?? {}}
            me={anonMe(peerHelp.code)}
          >
            <StageStudentView stageId={peerHelp.stageId} />
          </MirrorProvider>
        </div>
      </Fill>
    </Overlay>
  );
}

export default {
  slots: {
    teacherSidebar: TeacherSidebar,
    teacherOverlay: TeacherOverlay,
    studentOverlay: StudentOverlay,
    studentBanner: StudentBanner,
  },
  store: {
    student: { initial: { peerOpenAt: null, spotlightHiddenAt: null }, on: {} },
    teacher: { initial: {}, on: {} },
  },
};
