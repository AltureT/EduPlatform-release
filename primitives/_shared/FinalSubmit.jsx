// code / data-analysis 共用的"上交最终稿"（活动原语规格 §3.4 / §3.5，P3）。只给原语作者用。
//
//   <FinalSubmit finalAt prepare onConfirm hideButton? inline? />
//   主按钮"上交最终稿"（md 高、--brand 实心）+ 状态行（未上交：还没上交 · 运行记录会自动保存；已上交：已上交 HH:MM · 再次上交会覆盖）；
//   点按钮先调 prepare() 拼好载荷，弹 Overlay dialog 确认——载荷带 stale（代码在最近一次运行之后改过）时多一句
//   "代码改过，输出来自上次运行，建议先运行再上交"；确认后调 onConfirm(载荷)（原语发 student:code-final / student:data-final）
//   hideButton：只读（回看 / 镜像）时只留状态行；inline：放进 Page.Actions（窄屏）时状态行在左、按钮在右排成一行
//
//   finalRecord({ code, run, runCode, test, myData }) → 最终稿载荷（recordShape 形状，stale 时另带 stale: true）：当前代码 + 最近一次运行结果——
//     run：本页最近一次运行的 RunResult（runCode 为那次运行时的代码；没有 run 时用测试的 stdout）；
//     test：{ code, t } 本页最近一次测试，只在代码与当前相同时带上；本页没运行过：用已有的自动记录（myData）的输出，测试同样只在代码相同时带上。
//     输出来源的代码与当前代码不同 → stale: true
import { useState } from 'react';
import { Btn, Overlay, Stack } from '#kernel/client/index.js';
import { buildRecord } from '@components/sandbox/index.js';

const fmtHM = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
export const STALE_HINT = '代码改过，输出来自上次运行，建议先运行再上交';

export function finalRecord({ code, run = null, runCode, test = null, myData = null }) {
  const src = typeof code === 'string' ? code : '';
  const runs = Number(myData?.runs) || 0;
  let rec;
  let from = null;   // 输出来源那次的代码（不知道时 null，不算 stale）
  if (run || test) {
    const tests = test && test.code === src ? test.t : null;
    rec = buildRecord(run ?? { stdout: test.t?.stdout, ms: test.t?.ms }, { code: src, tests, runs });
    from = run ? (typeof runCode === 'string' ? runCode : null) : test.code;
  } else if (myData && typeof myData === 'object' && myData.submittedAt != null) {
    rec = {
      ...buildRecord(null, { code: src, runs }),
      stdout: typeof myData.stdout === 'string' ? myData.stdout : '',
      error: typeof myData.error === 'string' && myData.error ? myData.error : null,
      images: Array.isArray(myData.images) ? myData.images.filter((x) => typeof x === 'string' && x).slice(0, 1) : [],
      tests: myData.code === src && myData.tests && typeof myData.tests === 'object' ? myData.tests : null,
      ms: Number.isInteger(myData.ms) && myData.ms >= 0 ? myData.ms : 0,
    };
    from = typeof myData.code === 'string' ? myData.code : null;
  } else {
    rec = buildRecord(null, { code: src, runs });
  }
  return from != null && from !== src ? { ...rec, stale: true } : rec;
}

const status = { fontSize: 'var(--fs-sm)', lineHeight: 1.5 };

export default function FinalSubmit({ finalAt, prepare, onConfirm, hideButton = false, inline = false }) {
  const [pending, setPending] = useState(null);   // 待确认的载荷
  const done = finalAt != null;
  const statusLine = (
    <div data-testid="final-status" style={{ ...status, color: done ? 'var(--good)' : 'var(--ink-dim)' }}>
      {done ? `已上交 ${fmtHM(finalAt)} · 再次上交会覆盖` : '还没上交 · 运行记录会自动保存'}
    </div>
  );
  const button = hideButton ? null : (
    <Btn variant="primary" onClick={() => setPending((typeof prepare === 'function' ? prepare() : null) ?? {})}>上交最终稿</Btn>
  );
  const dialog = pending && (
    <Overlay variant="dialog" testId="final-confirm" onDismiss={() => setPending(null)}>
      <Stack gap={4}>
        <div style={{ fontSize: 'var(--fs-md)', lineHeight: 1.6 }}>把当前代码和最近一次输出作为最终稿上交？</div>
        {pending.stale === true && <div style={{ ...status, color: 'var(--warn)' }}>{STALE_HINT}</div>}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--sp-3)' }}>
          <Btn variant="ghost" onClick={() => setPending(null)}>取消</Btn>
          <Btn
            variant="primary"
            onClick={() => {
              const p = pending;
              setPending(null);
              onConfirm?.(p);
            }}
          >
            上交
          </Btn>
        </div>
      </Stack>
    </Overlay>
  );
  if (inline) {
    return (
      <div data-testid="final-submit" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        {statusLine}
        {button}
        {dialog}
      </div>
    );
  }
  return (
    <Stack gap={2} data-testid="final-submit">
      {button}
      {statusLine}
      {dialog}
    </Stack>
  );
}
