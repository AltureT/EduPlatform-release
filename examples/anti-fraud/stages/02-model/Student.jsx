import { useEffect, useRef } from 'react';
import { useStudentStage, useDraft, Page, Stack, Row, Card, Btn, Chip, Scroll } from '#kernel/client/index.js';
import { FEATURES, FEATURE_KEYS, MESSAGES, LINE, WEIGHT_MAX, scoreOf, step1Weights } from './data.js';

const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'center', fontSize: 'var(--fs-sm)' };
const textCell = { ...cell, textAlign: 'left' };

// 5 条短信 × 特征的表格；scores 为每条的得分，passedMark 为验证后每条是否落在正确一边
function MessageTable({ scores, passedMark }) {
  return (
    <Scroll>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={textCell}>短信</th>
            <th style={cell}>类型</th>
            {FEATURES.map((f) => (
              <th key={f.key} style={cell}>{f.label}</th>
            ))}
            <th style={cell}>得分</th>
            {passedMark && <th style={cell}>线 {LINE}</th>}
          </tr>
        </thead>
        <tbody>
          {MESSAGES.map((m, i) => (
            <tr key={m.id}>
              <td style={textCell}>{m.text}</td>
              <td style={cell}>
                <Chip tone={m.scam ? 'bad' : 'good'}>{m.scam ? '诈骗' : '正常'}</Chip>
              </td>
              {FEATURES.map((f) => (
                <td key={f.key} style={cell}>{m.features.includes(f.key) ? '●' : ''}</td>
              ))}
              <td style={{ ...cell, fontWeight: 600 }}>{scores[i]}</td>
              {passedMark && <td style={cell}>{passedMark[i] ? '✓' : '✗'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}

const defaultWeights = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, 20]));

export default function Student() {
  const { stage, isLive, myData, classData, send } = useStudentStage('model');
  const released = classData.released === true;

  // 学生输入一律 useDraft（刷新、断线、关浏览器、换设备不丢）；没改过时显示记录里的值
  const [pickedDraft, setPicked, { clear: clearPicked }] = useDraft('picked', null, { stageId: 'model' });
  const [weightsDraft, setWeights, { clear: clearWeights }] = useDraft('weights', null, { stageId: 'model' });
  const recPicked = myData?.step1Features ?? [];
  const recWeights = myData?.weights ?? defaultWeights();
  const picked = Array.isArray(pickedDraft) ? pickedDraft : recPicked;
  const weights = weightsDraft && typeof weightsDraft === 'object' ? weightsDraft : recWeights;

  // 服务端回执（记录里的值变了）后清掉对应草稿，显示记录；挂载时不清
  const seen = useRef({ p: JSON.stringify(myData?.step1Features ?? null), w: JSON.stringify(myData?.weights ?? null) });
  const pKey = JSON.stringify(myData?.step1Features ?? null);
  const wKey = JSON.stringify(myData?.weights ?? null);
  useEffect(() => {
    if (seen.current.p !== pKey) clearPicked();
    if (seen.current.w !== wKey) clearWeights();
    seen.current = { p: pKey, w: wKey };
  }, [pKey, wKey, clearPicked, clearWeights]);

  const toggle = (k) => setPicked((d) => {
    const p = Array.isArray(d) ? d : recPicked;
    return p.includes(k) ? p.filter((x) => x !== k) : [...p, k];
  });
  const step1Scores = MESSAGES.map((m) => scoreOf(m, step1Weights(picked)));
  const step2Scores = MESSAGES.map((m) => scoreOf(m, weights));

  const verified = myData?.verifyScores != null;
  const verifyMark = verified ? MESSAGES.map((m, i) => (m.scam ? myData.verifyScores[i] >= LINE : myData.verifyScores[i] < LINE)) : null;

  return (
    <Page template="stack" title={stage?.label}>
      <Page.Main>
        <Stack gap={4}>
          <Card>
            <Stack gap={3}>
              <Row gap={2}>
                <strong>第一步</strong>
                <span>勾选特征（每个 20 分）</span>
                {myData?.step1At && <Chip tone="good">已确定</Chip>}
              </Row>
              <Row gap={2}>
                {FEATURES.map((f) => (
                  <Btn key={f.key} size="sm" variant={picked.includes(f.key) ? 'primary' : 'soft'} aria-pressed={picked.includes(f.key)} disabled={!isLive} onClick={() => toggle(f.key)}>
                    {f.label}
                  </Btn>
                ))}
              </Row>
              <MessageTable scores={step1Scores} />
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <Row gap={2}>
                <strong>第二步</strong>
                <span>定权重，线 {LINE} 分</span>
                {!released && <Chip tone="neutral">等老师放权</Chip>}
                {verified && <Chip tone={myData.passed ? 'good' : 'bad'}>{myData.passed ? '验证通过' : '验证未通过'}</Chip>}
                {verified && <Chip tone="outline">已验证 {myData.verifyCount} 次</Chip>}
              </Row>
              {FEATURES.map((f) => (
                <Row key={f.key} gap={3} wrap={false}>
                  <span style={{ minWidth: 0, flex: '0 0 7em' }}>{f.label}</span>
                  <input
                    type="range"
                    min={0}
                    max={WEIGHT_MAX}
                    step={5}
                    value={weights[f.key]}
                    disabled={!isLive || !released}
                    aria-label={`${f.label} 权重`}
                    onChange={(e) => { const v = Number(e.target.value); setWeights((w) => ({ ...(w && typeof w === 'object' ? w : recWeights), [f.key]: v })); }}
                    style={{ flex: 1 }}
                  />
                  <span style={{ flex: '0 0 3em', textAlign: 'right' }}>{weights[f.key]}</span>
                </Row>
              ))}
              <MessageTable scores={released ? step2Scores : MESSAGES.map(() => '—')} passedMark={verifyMark} />
            </Stack>
          </Card>
        </Stack>
      </Page.Main>
      <Page.Actions>
        <Btn variant="soft" disabled={!isLive} onClick={() => send('student:pick', { features: picked })}>
          确定第一步
        </Btn>
        <Btn variant="primary" disabled={!isLive || !released} onClick={() => send('student:verify', { weights })}>
          验证我的设置
        </Btn>
      </Page.Actions>
    </Page>
  );
}
