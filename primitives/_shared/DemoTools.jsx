// code / data-analysis 共用的教师演示模式代码区（T9a，教师视图与学生页重排规格 §2.2；控件从原 _shared/LiveDemo.jsx 搬来）。只给原语作者用。
//
//   <DemoRunner stageId starters solution extraCompletions? />：演示视图（该段学生页、useStudentStage().demo 为真）Main 里的代码区
//   starters：[{ label, code }]（code 多份起始代码时 ≥ 2 份；否则一份 = 本段 starter）；solution：教师端 options.solution（可无）
//   - <PyRunner role="teacher" size="md">（P7 教师模式：不写记录、不写草稿、能读本段数据文件），受控 code / onChange 在这里；
//     代码存本地演示记录（useStudentStage().setMyData({ code })，内存，换段保留、classroom:reset 清空——内核 demo/demoStore.js），
//     没有记录时为第一份起始代码
//   - 工具栏右端（PyRunner 的 toolbarEnd）是 <DemoTools>：多份起始代码时下拉选哪份 +"载入起始代码"；有 solution 时"载入参考答案"
//     （只进编辑器，不改 showSolution、不公布）；"下发给学生"（ConfirmAdvanceBtn 两次点击）→ teacher:push-code { code }；
//     已下发时"已下发 HH:MM"与"撤回"（{ code: null }）；超过 20000 字不发，旁边一句"代码太长，发不出去（上限 2 万字）"
//   - 下发与撤回用教师 hook 的 send（演示模式里学生 hook 的 send 是 no-op）；已下发读教师端班级记录 perClass.pushedCode
import { useState } from 'react';
import { Btn, Chip, ConfirmAdvanceBtn, Row, useStudentStage, useTeacherStage } from '#kernel/client/index.js';
import { PyRunner } from '@components/sandbox/index.js';
import { PUSHED_MAX, pushedOf } from './pushCode.js';

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

export function DemoTools({ starters, solution, code, onLoad, pushed, send }) {
  const list = Array.isArray(starters) && starters.length > 0 ? starters : [{ label: '起始代码', code: '' }];
  const [which, setWhich] = useState(0);
  const [tooLong, setTooLong] = useState(false);
  const pick = list[which] ?? list[0];
  const push = () => {
    if (code.length > PUSHED_MAX) {
      setTooLong(true);
      return;
    }
    setTooLong(false);
    send('teacher:push-code', { code });
  };
  return (
    <Row gap={2} data-testid="demo-tools">
      {list.length > 1 && (
        <select aria-label="选哪份起始代码" value={which} onChange={(e) => setWhich(Number(e.target.value))} style={selectStyle}>
          {list.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
        </select>
      )}
      <Btn size="sm" variant="soft" onClick={() => onLoad(String(pick.code ?? ''))}>载入起始代码</Btn>
      {typeof solution === 'string' && solution !== '' && (
        <Btn size="sm" variant="soft" onClick={() => onLoad(solution)}>载入参考答案</Btn>
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
  );
}

export default function DemoRunner({ stageId, starters, solution, extraCompletions }) {
  const { myData, setMyData } = useStudentStage(stageId);
  const { perClass, send } = useTeacherStage(stageId);
  const list = Array.isArray(starters) && starters.length > 0 ? starters : [{ label: '起始代码', code: '' }];
  const code = typeof myData?.code === 'string' ? myData.code : String(list[0].code ?? '');
  const setCode = (v) => setMyData({ code: String(v ?? '') });
  return (
    <PyRunner
      stageId={stageId}
      role="teacher"
      size="md"
      code={code}
      onChange={setCode}
      extraCompletions={extraCompletions}
      toolbarEnd={<DemoTools starters={list} solution={solution} code={code} onLoad={setCode} pushed={pushedOf(perClass)} send={send} />}
    />
  );
}
