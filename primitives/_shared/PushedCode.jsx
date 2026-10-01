// code / data-analysis 共用的学生端"老师发来一份代码"（教师现场演示规格 §5，P7）。只给原语作者用。
//
//   const p = usePushedCode({ classData, isLive, readOnly, keyArgs });
//     p.pushed：班级记录里的下发 { code, at } | null
//     p.offer：本段当前段（isLive && !readOnly）、有下发、且这次下发（按 at）还没采用过 → 那份下发；否则 null
//     p.fromTeacher：本页采用过老师下发的代码（刷新后按 localStorage 的采用标记恢复）；原语据此给记录带 fromTeacher: true
//     p.markAdopted()：记下已采用这次下发（localStorage pushed:<lessonId>:<classEpoch>:<name>:<stageId> = at）并置 fromTeacher
//     p.setFromTeacher(false)：学生换了别的起点（code 的"换起点" / 选择页选了配置里的起点）后不再带标记
//   <PushedCodeOffer offer running onAdopt />：操作条里 Chip"老师发来一份代码"+ Btn soft"看一看"（data-testid="pushed-code-open"）；
//     点开 Overlay dialog：<CodeView size="sm" maxLines={30}>（放在可滚动的框里）+"换成这份（替换我现在的代码）"/"先不用"；
//     程序在运行时加一句"程序还在运行，换成这份会先停止它"（停止由原语的 onAdopt 做）。offer 为 null 时不渲染（撤回即消失）
import { useMemo, useState } from 'react';
import { Btn, Chip, CodeView, Overlay, Stack } from '#kernel/client/index.js';
import { pushedKey, readPushed, writePushed } from '#components/sandbox/client/ui/draftStorage.js';
import { pushedOf } from './pushCode.js';

export const PREVIEW_MAX_LINES = 30;

export function usePushedCode({ classData, isLive, readOnly, keyArgs }) {
  const key = pushedKey(keyArgs);
  const [mine, setMine] = useState(null);   // 本页采用的 at（localStorage 不可用时也生效）
  const stored = useMemo(() => readPushed(key), [key, mine]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [flag, setFlag] = useState(null);   // null：跟随采用标记
  const pushed = pushedOf(classData);
  const adopted = pushed != null && (pushed.at === stored || pushed.at === mine);
  const offer = pushed && isLive && !readOnly && !adopted ? pushed : null;
  return {
    pushed,
    offer,
    fromTeacher: flag ?? (stored != null || mine != null),
    markAdopted() {
      if (!pushed) return;
      writePushed(key, pushed.at);
      setMine(pushed.at);
      setFlag(true);
    },
    setFromTeacher: setFlag,
  };
}

const boxStyle = { maxHeight: 'calc(var(--fs-sm) * 1.6 * 20)', overflow: 'auto' };

export function PushedCodeOffer({ offer, running = false, onAdopt }) {
  const [open, setOpen] = useState(false);
  if (!offer) return null;
  return (
    <>
      <Chip tone="accent">老师发来一份代码</Chip>
      <Btn variant="soft" size="sm" data-testid="pushed-code-open" onClick={() => setOpen(true)}>看一看</Btn>
      {open && (
        <Overlay variant="dialog" testId="pushed-code-dialog" label="老师发来的代码" onDismiss={() => setOpen(false)}>
          <Stack gap={3}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--ink)' }}>老师发来的代码</div>
            <div style={boxStyle}>
              <CodeView code={offer.code} size="sm" maxLines={PREVIEW_MAX_LINES} />
            </div>
            {running && <div data-testid="pushed-code-running" style={{ fontSize: 'var(--fs-sm)', color: 'var(--warn)', lineHeight: 1.5 }}>程序还在运行，换成这份会先停止它</div>}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => setOpen(false)}>先不用</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setOpen(false);
                  onAdopt(offer);
                }}
              >
                换成这份（替换我现在的代码）
              </Btn>
            </div>
          </Stack>
        </Overlay>
      )}
    </>
  );
}
