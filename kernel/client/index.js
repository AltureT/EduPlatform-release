// 【公开入口】规格 §2 / 契约 §一：只具名导出，无命名空间。
// StepBar、ViewToggle 是外壳内部件，不从这里导出。
export { useStudentStage, useTeacherStage } from './hooks/useStage.js';

export { default as Bar } from './ui/Bar.jsx';
export { default as Btn } from './ui/Btn.jsx';
export { default as Card } from './ui/Card.jsx';
export { default as Chip } from './ui/Chip.jsx';
export { default as HelpTip } from './ui/HelpTip.jsx';
export { default as GroupTag } from './ui/GroupTag.jsx';
export { default as ConfirmAdvanceBtn } from './ui/ConfirmAdvanceBtn.jsx';
// U6（代码展示统一高亮规格 §2）：展示代码一律用它（Python 高亮、--code-* 令牌），不用裸 <pre>
export { default as CodeView } from './ui/CodeView.jsx';

export { default as DataTable } from './table/DataTable.jsx';
export { default as DetailModal } from './table/DetailModal.jsx';
export { default as AlertBar } from './table/AlertBar.jsx';

export { default as BarDistribution } from './charts/BarDistribution.jsx';
export { default as ProgressBadge } from './charts/ProgressBadge.jsx';

// v0.5（规格 §2.3、§2.4）：组件机制
export { useComponent } from './hooks/useComponent.js';
export { default as MirrorProvider } from './mirror/MirrorProvider.jsx';
export { default as StageStudentView } from './mirror/StageStudentView.jsx';
// 过时：组件请用 client.jsx 的 slots；curtainSlot 钩子保留以兼容
export { registerKernelHook } from './stores/kernelHooks.js';

// v0.7（界面整理规格 §3）：页面模板与布局原语（规格早先写的 @kernel/layout 即指此入口）
export { Page, Fill, Split, Tiles, Tile, Stack, Row, Scroll, useNarrow } from './layout/index.js';
// 规格 v0.2.1 §2.3：覆盖层 { variant: 'dialog'|'panel'|'drawer'|'menu', label, onDismiss, testId, children }，
// 唯一允许 position: fixed 的地方；组件的弹层一律用它
export { default as Overlay } from './shells/Overlay.jsx';
// 学生输入自动保存（学生输入自动保存规格 §2.2）：学生输入一律 useDraft，不用裸 useState
export { useDraft, draftKey, readDraft, writeDraft, clearDraft } from './drafts.js';
