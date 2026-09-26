import { useEffect, useState } from 'react';
import { useStudentStage, Page, Stack, Row, Card, Btn, Chip, Scroll } from '#kernel/client/index.js';
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

  const [picked, setPicked] = useState(myData?.step1Features ?? []);
  const [weights, setWeights] = useState(myData?.weights ?? defaultWeights());

  // 刷新恢复或服务端回执时回填
  useEffect(() => {
    if (myData?.step1Features) setPicked(myData.step1Features);
  }, [myData?.step1Features]);
  useEffect(() => {
    if (myData?.weights) setWeights(myData.weights);
  }, [myData?.weights]);

  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
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
                    onChange={(e) => setWeights((w) => ({ ...w, [f.key]: Number(e.target.value) }))}
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
