// code / data-analysis 共用的教师大屏"现场演示"区（教师现场演示规格 §2，P7）。只给原语作者用。
//
//   <LiveDemo stageId starters solution pushed send />
//   starters：[{ label, code }]（code 多份起始代码时 ≥ 2 份；否则一份 = 本段 starter）；solution：教师端 options.solution（可无）；
//   pushed：perClass.pushedCode（{ code, at } | null）；send：useTeacherStage().send
//   - 上方一行小按钮：多份起始代码时一个下拉选哪份 +"载入起始代码"（编辑器换成那份）；有 solution 时"载入参考答案"（只进编辑器，
//     不改 showSolution、不公布）；"下发给学生"（ConfirmAdvanceBtn 两次点击）→ teacher:push-code { code }；
//     已下发时旁边"已下发 HH:MM"与"撤回"（teacher:push-code { code: null }）
//   - 下方 <PyRunner role="teacher" size="md">（受控：code / onChange 在这里）：不产生任何记录、不写草稿；运行时能读到本段数据文件
//   - 演示代码留在内存里：收起再打开（本组件卸载再挂载）、切到统计视图再回来都还在；内存键 = classEpoch + 段 id，
//     换段（stageId 变）时清掉别的段的内容、回到本段第一份起始代码；classroom:reset 时清空（教师端 useComponent().classEpoch 恒为 null——
//     教师 store 不存它——所以重置靠内核 reset 钩子：第一次用到演示区时登记一次，之后常驻）
//   - "下发给学生"前查长度：超过 20000 字不发，按钮旁一句"代码太长，发不出去（上限 2 万字）"
import { useCallback, useState } from 'react';
import { Btn, Chip, ConfirmAdvanceBtn, Fill, Row, registerKernelHook, useComponent } from '#kernel/client/index.js';
import { PyRunner } from '@components/sandbox/index.js';
import { PUSHED_MAX } from './pushCode.js';

const memo = new Map();   // `${classEpoch}:${stageId}` → 演示代码
let resetHooked = false;
// 测试用：清掉内存里的演示代码
export function __resetLiveDemo() {
  memo.clear();
}

function useDemoCode(stageId, classEpoch, initial) {
  const key = `${classEpoch ?? ''}:${stageId}`;
  const [state, setState] = useState(() => {
    if (!resetHooked) {
      resetHooked = true;
      registerKernelHook('reset', () => memo.clear());
    }
    for (const k of [...memo.keys()]) if (k !== key) memo.delete(k);   // 换段 / 换课堂：别的段的内容清掉
    return { key, code: memo.has(key) ? memo.get(key) : initial };
  });
  const setCode = useCallback((v) => {
    const next = String(v ?? '');
    memo.set(key, next);
    setState({ key, code: next });
  }, [key]);
  return [state.code, setCode];
}

const fmtHM = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
const selectStyle = {
  font: 'inherit',
  fontSize: 'var(--fs-sm)',
  color: 'var(--ink)',
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--sp-2)',
  minHeight: 'var(--control-h-sm)',
};

export default function LiveDemo({ stageId, starters, solution, pushed, send }) {
  const list = Array.isArray(starters) && starters.length > 0 ? starters : [{ label: '起始代码', code: '' }];
  const { classEpoch } = useComponent('sandbox');
  const [code, setCode] = useDemoCode(stageId, classEpoch, String(list[0].code ?? ''));
  const [which, setWhich] = useState(0);
  const [tooLong, setTooLong] = useState(false);
  const push = () => {
    if (code.length > PUSHED_MAX) {
      setTooLong(true);
      return;
    }
    setTooLong(false);
    send('teacher:push-code', { code });
  };
  const pick = list[which] ?? list[0];

  return (
    <Fill data-testid="live-demo">
      <div style={{ flexShrink: 0, paddingBottom: 'var(--sp-2)' }}>
        <Row gap={2}>
          {list.length > 1 && (
            <select aria-label="选哪份起始代码" value={which} onChange={(e) => setWhich(Number(e.target.value))} style={selectStyle}>
              {list.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
            </select>
          )}
          <Btn size="sm" variant="soft" onClick={() => setCode(pick.code)}>载入起始代码</Btn>
          {typeof solution === 'string' && solution !== '' && (
            <Btn size="sm" variant="soft" onClick={() => setCode(solution)}>载入参考答案</Btn>
          )}
          <ConfirmAdvanceBtn size="sm" variant="soft" data-testid="push-code" onAdvance={push}>
            下发给学生
          </ConfirmAdvanceBtn>
          {tooLong && code.length > PUSHED_MAX && (
            <span role="alert" data-testid="push-too-long" style={{ color: 'var(--bad)', fontSize: 'var(--fs-sm)' }}>代码太长，发不出去（上限 2 万字）</span>
          )}
          {pushed && (
            <>
              <Chip tone="good">已下发 {fmtHM(pushed.at)}</Chip>
              <Btn size="sm" variant="ghost" onClick={() => send('teacher:push-code', { code: null })}>撤回</Btn>
            </>
          )}
        </Row>
      </div>
      <PyRunner stageId={stageId} role="teacher" size="md" code={code} onChange={setCode} />
    </Fill>
  );
}
