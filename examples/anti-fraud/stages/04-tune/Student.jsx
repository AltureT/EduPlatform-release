import { useEffect, useRef } from 'react';
import { useStudentStage, useDraft, Page, Stack, Row, Card, Btn, Chip } from '#kernel/client/index.js';
import { Sliders, ScoreAxis, Trajectory, Contribution, ResultChips, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD } from './Panel.jsx';

const TREND_OPTIONS = [
  { key: 'up', label: '升' },
  { key: 'down', label: '降' },
  { key: 'same', label: '差不多' },
];
const TREND_TEXT = { up: '升', down: '降', same: '差不多' };
const trendText = (t) => (t ? TREND_TEXT[t] : '（没有上一次可比）');
const mark = (hit) => (hit === true ? '✓' : hit === false ? '✗' : '');

const numberInput = {
  flex: '0 0 5em',
  padding: '6px 8px',
  fontSize: 'var(--fs-md)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--ink)',
};

function TrendPicker({ label, value, disabled, onChange }) {
  return (
    <Row gap={2}>
      <span style={{ flex: '0 0 9em' }}>{label}</span>
      {TREND_OPTIONS.map((o) => (
        <Btn key={o.key} size="sm" variant={value === o.key ? 'primary' : 'soft'} aria-pressed={value === o.key} disabled={disabled} onClick={() => onChange(o.key)}>
          {o.label}
        </Btn>
      ))}
    </Row>
  );
}

const emptyPredict = { caught: '', blocked: '', recallTrend: null, precisionTrend: null };

export default function Student() {
  const { stage, isLive, myData, send } = useStudentStage('tune');
  const last = myData?.last ?? null;
  const tests = myData?.tests ?? 0;

  // 学生输入一律 useDraft（刷新、断线、关浏览器、换设备不丢）；没改过时显示最后一次检验的设置
  const [weightsDraft, setWeightsDraft, { clear: clearWeights }] = useDraft('weights', null, { stageId: 'tune' });
  const [thresholdDraft, setThresholdDraft, { clear: clearThreshold }] = useDraft('threshold', null, { stageId: 'tune' });
  const [predictDraft, setPredictDraft, { clear: clearPredict }] = useDraft('predict', null, { stageId: 'tune' });
  const weights = weightsDraft && typeof weightsDraft === 'object' ? weightsDraft : (last?.weights ?? DEFAULT_WEIGHTS);
  const threshold = typeof thresholdDraft === 'number' ? thresholdDraft : (last?.threshold ?? DEFAULT_THRESHOLD);
  const predict = predictDraft && typeof predictDraft === 'object' ? { ...emptyPredict, ...predictDraft } : emptyPredict;
  const setWeights = (v) => setWeightsDraft(typeof v === 'function' ? v(weights) : v);
  const setThreshold = (v) => setThresholdDraft(typeof v === 'function' ? v(threshold) : v);
  const setPredict = (v) => setPredictDraft(typeof v === 'function' ? v(predict) : v);

  // 每次检验后（last.at 变了）清掉草稿：设置回到这次检验的值、预测清空；挂载时不清
  const seenAt = useRef(last?.at ?? null);
  useEffect(() => {
    const at = last?.at ?? null;
    if (seenAt.current === at) return;
    seenAt.current = at;
    clearWeights();
    clearThreshold();
    clearPredict();
  }, [last?.at, clearWeights, clearThreshold, clearPredict]);

  const needPredict = tests > 0;
  const predictFilled =
    predict.caught !== '' && predict.blocked !== '' && predict.recallTrend != null && predict.precisionTrend != null;
  const canTest = isLive && (!needPredict || predictFilled);

  const onTest = () => {
    const payload = { weights, threshold, predict: {} };
    if (predictFilled) {
      payload.predict = {
        caught: Math.round(Number(predict.caught)),
        blocked: Math.round(Number(predict.blocked)),
        recallTrend: predict.recallTrend,
        precisionTrend: predict.precisionTrend,
      };
    }
    send('student:test', payload);
  };

  const setNum = (key) => (e) => setPredict((p) => ({ ...p, [key]: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }));

  return (
    <Page template="split" title={stage?.label} hint={`已检验 ${tests} 次`} sideLabel="结果">
      <Page.Main>
        <Stack gap={4}>
          <Card>
            <Sliders
              weights={weights}
              threshold={threshold}
              disabled={!isLive}
              onWeight={(k, v) => setWeights((w) => ({ ...w, [k]: v }))}
              onThreshold={setThreshold}
            />
          </Card>
          <Card>
            <Stack gap={2}>
              <Row gap={2}>
                <strong>实验日志 · 检验前预测</strong>
                {!needPredict && <Chip tone="neutral">第一次可不填</Chip>}
              </Row>
              <Row gap={2}>
                <span style={{ flex: '0 0 9em' }}>能抓到几条诈骗</span>
                <input inputMode="numeric" value={predict.caught} onChange={setNum('caught')} disabled={!isLive} aria-label="预测能抓到几条诈骗" style={numberInput} />
                <span>/ 60</span>
              </Row>
              <Row gap={2}>
                <span style={{ flex: '0 0 9em' }}>会误拦几条正常</span>
                <input inputMode="numeric" value={predict.blocked} onChange={setNum('blocked')} disabled={!isLive} aria-label="预测会误拦几条正常短信" style={numberInput} />
                <span>/ 40</span>
              </Row>
              <TrendPicker label="查全率比上次" value={predict.recallTrend} disabled={!isLive} onChange={(v) => setPredict((p) => ({ ...p, recallTrend: v }))} />
              <TrendPicker label="查准率比上次" value={predict.precisionTrend} disabled={!isLive} onChange={(v) => setPredict((p) => ({ ...p, precisionTrend: v }))} />
            </Stack>
          </Card>
        </Stack>
      </Page.Main>
      <Page.Side>
        <Stack gap={3}>
          {last ? (
            <>
              <Row gap={2}>
                <Chip tone={last.success ? 'good' : 'bad'}>{last.success ? '这次成功' : '这次没成功'}</Chip>
                {!last.success && myData?.failReason && <span>{myData.failReason}</span>}
              </Row>
              <ResultChips result={last} />
              {last.predict && (
                <Card>
                  <Stack gap={1}>
                    <Row gap={2}>
                      <strong>预测 vs 实际</strong>
                      <Chip tone="brand">猜中 {last.hits}/4</Chip>
                    </Row>
                    <span>抓到几条：预测 {last.predict.caught}，实际 {last.caught} {mark(last.hitItems?.caught)}</span>
                    <span>误拦几条：预测 {last.predict.blocked}，实际 {last.blocked} {mark(last.hitItems?.blocked)}</span>
                    <span>
                      查全率比上次：预测{TREND_TEXT[last.predict.recallTrend]}，实际{trendText(last.hitItems?.actual?.recallTrend)} {mark(last.hitItems?.recallTrend)}
                    </span>
                    <span>
                      查准率比上次：预测{TREND_TEXT[last.predict.precisionTrend]}，实际{trendText(last.hitItems?.actual?.precisionTrend)} {mark(last.hitItems?.precisionTrend)}
                    </span>
                  </Stack>
                </Card>
              )}
              <ScoreAxis weights={last.weights} threshold={last.threshold} />
              <Trajectory history={myData?.history} />
              <Contribution weights={last.weights} threshold={last.threshold} />
            </>
          ) : (
            <Chip tone="neutral">还没有检验</Chip>
          )}
        </Stack>
      </Page.Side>
      <Page.Actions>
        <Btn variant="primary" disabled={!canTest} onClick={onTest}>
          检验
        </Btn>
      </Page.Actions>
    </Page>
  );
}
