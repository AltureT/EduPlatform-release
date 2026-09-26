import { useTeacherStage, Page, Stack, Row, Bar, Scroll } from '#kernel/client/index.js';
import { TEST_SET } from './data.js';

// 演示视图"误拦反思"：16 条正常测试短信，每条被多少人误拦，按人数从多到少
export default function TeacherDemo() {
  const { roster, perStudent } = useTeacherStage('intercept');
  const connected = roster.filter((s) => s.connected);
  const records = Object.values(perStudent).filter((r) => Array.isArray(r?.blockedIds));
  const rows = TEST_SET.filter((s) => s.type === 'normal')
    .map((s) => ({ ...s, count: records.filter((r) => r.blockedIds.includes(s.id)).length }))
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, records.length);

  return (
    <Page template="focus" title="误拦反思：这些正常短信被拦了" hint={`已跑完 ${records.length}/${connected.length}`}>
      <Page.Main>
        <Scroll>
          <Stack gap={2}>
            {rows.map((s) => (
              <Row key={s.id} gap={3} wrap={false}>
                <span style={{ flex: 3, minWidth: 0 }}>{s.text}</span>
                <span style={{ flex: 1 }}>
                  <Bar value={s.count} max={max} height={12} color="var(--bad)" />
                </span>
                <span style={{ flex: '0 0 4em', textAlign: 'right', fontWeight: 600 }}>{s.count} 人</span>
              </Row>
            ))}
          </Stack>
        </Scroll>
      </Page.Main>
    </Page>
  );
}
