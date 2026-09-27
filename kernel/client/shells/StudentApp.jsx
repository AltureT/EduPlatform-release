// 学生端外壳（规格 §9.2；v0.7 界面整理规格 §2.2）：!joined → 登录；!hydrated → 空；否则 <Shell role="student">：
// - 顶栏：品牌 + 步骤条（narrow 折叠为 "序号 / 总数 · 名称"）+ 重连中 / 本人名字
// - 横幅区：服务端拒绝的一句话提示（4 秒后消失）、回看
// - 内容（overflow: hidden）：live 阶段始终挂载（回看时隐藏），回看阶段按 stage.config.reviewInteractive 决定是否加 inert 锁
// - 操作条：当前可见窗格里 <Page.Actions> 的内容；回看锁定时操作条同样 inert
// 断线期间不卸载阶段视图（只显示"重连中"），重连后 join-ok 前渲染空——理由见 stores/coreStudentStore.js 顶部
// 谢幕 override 取自 lesson.curtain.override
import { useEffect, useMemo, useState } from 'react';
import { coreStudentStore } from '../stores/coreStudentStore.js';
import { assembleStages } from '../stores/stageStores.js';
import StepBar from '../ui/StepBar.jsx';
import Shell from '../layout/Shell.jsx';
import { ActionSinkContext, createActionSink } from '../layout/actionSink.js';
import { PageStageContext } from '../layout/pageContext.js';
import { useNarrow } from '../layout/useNarrow.js';
import Brand from './Brand.jsx';
import StudentLogin from './StudentLogin.jsx';
import Curtain from './Curtain.jsx';
import { useLessonChrome } from './useLessonChrome.js';
import { ComponentSlot, useStudentBanner } from './ComponentSlots.jsx';
import { KernelRoleContext } from '../hooks/roleContext.js';

// PageStageContext 带 lessonId：<Page resizable> 按课记拖宽比例（P5 规格 §4）
// C5：isLive 经 PageStageContext 交给 <Page>，作为 studentAside 槽位的 props
function StageView({ entry, curtainOverride, lessonId = null, isLive = true }) {
  if (!entry) return null;
  if (entry.id === 'prelogin') return <StudentLogin />;
  if (entry.id === 'curtain') return <Curtain role="student" title={entry.label} overrideDir={curtainOverride} />;
  const Comp = entry.Student;
  if (!Comp) return null;
  return (
    <PageStageContext.Provider value={{ view: 'student', config: entry.config, lessonId, isLive }}>
      <Comp />
    </PageStageContext.Provider>
  );
}

// overflow: auto 兜底：未迁移到 <Page> 的阶段超高时可在窗格内滚动；<Page> 根是 flex: 1 / min-height: 0，不会触发这里滚动
const paneStyle = { display: 'flex', flexDirection: 'column', flex: '1 1 0%', minHeight: 0, minWidth: 0, overflow: 'auto' };

const bannerBase = {
  padding: 'var(--sp-2) var(--sp-4)',
  fontSize: 'var(--fs-sm)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  borderBottom: '1px solid var(--border)',
};

// v0.5 组件槽位（规格 §2.3）：studentOverlay 在已加入后的外壳之外；studentCurtain 由 Curtain 在谢幕 / override 之后渲染；
// v0.7.1 studentBanner 在横幅区（内核横幅之后），已加入后即渲染（含课前等待期）
export default function StudentApp() {
  return (
    <KernelRoleContext.Provider value="student">
      <StudentShell />
    </KernelRoleContext.Provider>
  );
}

function StudentShell() {
  const connect = coreStudentStore((s) => s.connect);
  const joined = coreStudentStore((s) => s.joined);
  const hydrated = coreStudentStore((s) => s.hydrated);
  const stageIndex = coreStudentStore((s) => s.stageIndex);
  const viewedStageIndex = coreStudentStore((s) => s.viewedStageIndex);
  const setViewedStageIndex = coreStudentStore((s) => s.setViewedStageIndex);
  const connected = coreStudentStore((s) => s.connected);
  const name = coreStudentStore((s) => s.name);
  const stages = coreStudentStore((s) => s.stages);
  const lesson = coreStudentStore((s) => s.lesson);
  const validationError = coreStudentStore((s) => s.validationError);
  const narrow = useNarrow();
  const componentBanner = useStudentBanner();
  const [liveSink] = useState(createActionSink);
  const [reviewSink] = useState(createActionSink);

  useLessonChrome(lesson);

  // 服务端拒绝（error:validation）→ 横幅区一句话提示，4 秒后消失（"平台不说废话"允许的一句话错误提示）
  const [toast, setToast] = useState(null);
  useEffect(() => {
    // validationError 被清空（classroom:reset）→ 提示立刻消失，不等 4 秒
    if (!validationError || !validationError.message) {
      setToast(null);
      return undefined;
    }
    setToast(validationError.message);
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [validationError]);

  useEffect(() => {
    connect();
  }, [connect]);

  const entries = useMemo(() => assembleStages(stages), [stages]);
  const steps = useMemo(() => stages.map((s) => s.label), [stages]);

  if (!joined) return <StudentLogin />;
  if (!hydrated) return null;

  const liveEntry = entries[stageIndex] || null;
  // v0.6：已加入且课前等待时也挂 studentOverlay（组件可在此预载；无组件时槽位为空，DOM 不变）
  if (liveEntry && liveEntry.id === 'prelogin') {
    return (
      <>
        <StudentLogin banner={componentBanner} />
        <ComponentSlot role="student" slot="studentOverlay" />
      </>
    );
  }

  const curtainOverride = lesson.curtain ? lesson.curtain.override : null;
  const isReviewing = viewedStageIndex !== stageIndex && viewedStageIndex >= 1;
  const reviewedEntry = isReviewing ? entries[viewedStageIndex] || null : null;
  const lockReview = isReviewing && !(reviewedEntry && reviewedEntry.config && reviewedEntry.config.reviewInteractive === true);

  const header = (
    <>
      <Brand glyph={lesson.glyph} title={narrow ? null : lesson.title} size="sm" />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
        <StepBar steps={steps} step={stageIndex} viewed={viewedStageIndex} onSelect={setViewedStageIndex} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 }}>
        {!connected && (
          <div data-testid="reconnecting" style={{
            height: 28,
            padding: '0 10px',
            borderRadius: 999,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            fontSize: 'var(--fs-xs)',
            fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)', animation: 'pulse 1s infinite' }} />
            重连中…
          </div>
        )}
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{name}</div>
      </div>
    </>
  );

  const banner = [
    toast && (
      <div key="toast" role="alert" style={{ ...bannerBase, background: 'var(--bad-soft)', color: 'var(--bad)', fontWeight: 600 }}>
        {toast}
      </div>
    ),
    isReviewing && (
      <div key="review" data-testid="review-banner" style={{ ...bannerBase, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <span>回看 · {reviewedEntry ? reviewedEntry.label : ''}</span>
        <button
          type="button"
          onClick={() => setViewedStageIndex(stageIndex)}
          style={{
            height: 'var(--control-h-sm)', padding: '0 var(--sp-3)', borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)', color: 'var(--surface)',
            border: 'none', fontSize: 'inherit', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          回到当前 →
        </button>
      </div>
    ),
    // v0.7.1：组件 studentBanner 槽位，在内核横幅之后，每个组件一行、按 lesson.config 顺序纵向堆叠；回看时也显示
    componentBanner,
  ];

  return (
    <>
      <Shell
        role="student"
        header={header}
        banner={banner}
        sink={isReviewing ? reviewSink : liveSink}
        inertActions={lockReview}
      >
        {/* live 阶段始终挂载，回看时隐藏以保留其本地状态 */}
        <div data-testid="live-view" style={{ ...paneStyle, display: isReviewing ? 'none' : 'flex' }}>
          <ActionSinkContext.Provider value={liveSink}>
            <StageView entry={liveEntry} curtainOverride={curtainOverride} lessonId={lesson.id} />
          </ActionSinkContext.Provider>
        </div>
        {isReviewing && reviewedEntry && (
          <div data-testid="review-view" inert={lockReview} style={paneStyle}>
            <ActionSinkContext.Provider value={reviewSink}>
              <StageView entry={reviewedEntry} curtainOverride={curtainOverride} lessonId={lesson.id} isLive={false} />
            </ActionSinkContext.Provider>
          </div>
        )}
      </Shell>
      <ComponentSlot role="student" slot="studentOverlay" />
    </>
  );
}
