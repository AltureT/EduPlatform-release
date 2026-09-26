// mirror 客户端（规格 §3.1）：本地状态 slice = { target: name | null }，只用 setLocal，不走 socket
// 布局（界面整理规格 §2.3 / §3）：下拉走内核 Overlay 的 menu 形态；镜像主区是 <Fill>，撑满外壳内容区
import { useEffect, useState } from 'react';
import {
  useComponent,
  useTeacherStage,
  MirrorProvider,
  StageStudentView,
  registerKernelHook,
  Btn,
  Chip,
  Fill,
  Row,
  Overlay,
  useNarrow,
} from '#kernel/client/index.js';

function useMirror(stageId) {
  const comp = useComponent('mirror');
  const { setLocal } = comp;
  // 推进时退出镜像。不能在模块顶层注册：内核用 eager glob 加载本文件，
  // 此时 #kernel/client/index.js 尚未初始化完（循环引用），registerKernelHook 为 undefined。
  // 注册返回注销函数，作为 effect 清理。
  useEffect(() => registerKernelHook('stageChange', () => setLocal({ target: null })), [setLocal]);
  const { roster } = useTeacherStage(stageId);
  const target = comp.slice?.target ?? null;
  const online = (roster ?? []).filter((s) => s.connected);
  const entry = target == null ? null : (roster ?? []).find((s) => s.name === target) ?? null;
  const offline = target != null && !(entry && entry.connected);
  return { comp, target, online, entry, offline };
}

function pickRandom(list, exclude) {
  const pool = list.filter((s) => s.name !== exclude);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)].name;
}

function mirrorLabel(target, offline) {
  return offline ? `镜像 · ${target} · 离线 · 只读` : `镜像 · ${target} · 只读`;
}

function TeacherToolbar({ stageId, isLive }) {
  const { comp, target, online, offline } = useMirror(stageId);
  const [open, setOpen] = useState(false);
  // 顶栏芯片用 sm；narrow 时 toolbar 收进操作条"更多 ▾"菜单，不在顶栏，用 md（界面整理规格 §4）
  const chipSize = useNarrow() ? 'md' : 'sm';

  if (isLive === false || !comp.isEnabledFor(stageId)) return null;

  const choose = (name) => {
    setOpen(false);
    if (name != null) comp.setLocal({ target: name });
  };

  if (target != null) {
    const next = pickRandom(online, target);
    return (
      <Row gap={2} wrap={false} data-mirror="toolbar">
        <Chip tone={offline ? 'warn' : 'brand'}>{mirrorLabel(target, offline)}</Chip>
        <Btn size={chipSize} variant="soft" disabled={next == null} onClick={() => choose(next)}>
          换一位
        </Btn>
        <Btn size={chipSize} variant="ghost" aria-label="退出镜像" title="退出镜像" onClick={() => comp.setLocal({ target: null })}>
          ✕
        </Btn>
      </Row>
    );
  }

  return (
    <Row gap={2} wrap={false} data-mirror="toolbar">
      <Btn size={chipSize} variant="soft" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        👁 镜像 ▾
      </Btn>
      {open && (
        <Overlay variant="menu" label="镜像" testId="mirror-menu" onDismiss={() => setOpen(false)}>
          <Row gap={2}>
            <Btn variant="primary" disabled={online.length === 0} onClick={() => choose(pickRandom(online, null))}>
              随机
            </Btn>
            {online.map((s) => (
              <Btn key={s.name} variant="ghost" onClick={() => choose(s.name)}>
                {s.name}
              </Btn>
            ))}
          </Row>
        </Overlay>
      )}
    </Row>
  );
}

function TeacherMain({ children, stageId, isLive }) {
  const { comp, target, entry, offline } = useMirror(stageId);

  if (target == null || isLive === false) return children;

  const { perStudent, perClass } = comp.stageData(stageId);
  const me = entry
    ? { name: entry.name, enteredStageAt: entry.enteredStageAt ?? null, enteredStageIndex: entry.enteredStageIndex ?? null }
    : { name: target, enteredStageAt: null, enteredStageIndex: null };

  return (
    <Fill data-testid="mirror-main" data-target={target}>
      <div style={{ flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--sp-4)' }}>
        <Row gap={2}>
          <Chip tone={offline ? 'warn' : 'brand'}>{mirrorLabel(target, offline)}</Chip>
        </Row>
        <div
          style={{
            flex: '1 1 0%',
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg)',
          }}
        >
          <MirrorProvider name={target} record={perStudent?.[target] ?? {}} classData={perClass ?? {}} me={me}>
            <StageStudentView stageId={stageId} />
          </MirrorProvider>
        </div>
      </div>
    </Fill>
  );
}

export default {
  slots: {
    teacherToolbar: TeacherToolbar,
    teacherMain: TeacherMain,
  },
  store: {
    teacher: { initial: { target: null }, on: {} },
  },
};
