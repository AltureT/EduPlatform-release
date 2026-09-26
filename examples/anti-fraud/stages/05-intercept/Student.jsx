import { useEffect, useRef } from 'react';
import { useStudentStage, Page, Stack, Row, Bar, Chip, Card } from '#kernel/client/index.js';
import { TYPES } from './data.js';

const pct = (x) => `${Math.round(x * 100)}%`;

// 页面样式 focus：学生不操作，只看自己第 4 段最后一次设置在统一测试短信上的结果
export default function Student() {
  const { stage, isLive, myData, send } = useStudentStage('intercept');
  // 第 4 段（开放调参）本人的记录，只读：取最后一次检验的设置
  const { myData: tuneData } = useStudentStage('tune');
  const setting = tuneData?.last ?? null;
  const sentRef = useRef(false);

  // 进入本段自动跑一次：还没有本段结果、第 4 段有设置时发
  useEffect(() => {
    if (!isLive || sentRef.current || myData?.ranAt != null || !setting?.weights) return;
    sentRef.current = true;
    send('student:run', { weights: setting.weights, threshold: setting.threshold });
  }, [isLive, myData?.ranAt, setting?.weights, setting?.threshold]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page template="focus" title={stage?.label}>
      <Page.Main>
        {myData?.ranAt != null ? (
          <Stack gap={4}>
            <Card>
              <Stack gap={3}>
                {TYPES.map((t) => {
                  const b = myData.byType?.[t.key] ?? { caught: 0, total: 0 };
                  return (
                    <Row key={t.key} gap={3} wrap={false}>
                      <span style={{ flex: '0 0 7em' }}>{t.label}</span>
                      <span style={{ flex: 1 }}>
                        <Bar value={b.caught} max={Math.max(1, b.total)} height={14} />
                      </span>
                      <span style={{ flex: '0 0 4em', textAlign: 'right', fontWeight: 600 }}>
                        {b.caught}/{b.total}
                      </span>
                    </Row>
                  );
                })}
              </Stack>
            </Card>
            <Row gap={2}>
              <Chip tone={myData.blocked > 0 ? 'bad' : 'good'}>误拦 {myData.blocked}/16</Chip>
              <Chip tone="outline">查全 {pct(myData.recall)}</Chip>
              <Chip tone="outline">查准 {pct(myData.precision)}</Chip>
              <Chip tone="brand">F1 {myData.f1}</Chip>
            </Row>
          </Stack>
        ) : (
          <Chip tone="neutral">{setting ? '正在跑……' : '第 4 段没有检验记录'}</Chip>
        )}
      </Page.Main>
    </Page>
  );
}
