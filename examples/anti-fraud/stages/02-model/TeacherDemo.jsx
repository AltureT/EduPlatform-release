import { useTeacherStage, Page, Btn, Chip, Scroll } from '#kernel/client/index.js';
import { FEATURES, MESSAGES, LINE } from './data.js';

const cell = { padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center', fontSize: 'var(--fs-md)' };
const textCell = { ...cell, textAlign: 'left' };

// 演示视图：两步表格演示（5 条短信 × 特征），次要按钮 [放权] 进外壳操作条；推进由外壳提供
export default function TeacherDemo() {
  const { roster, perStudent, perClass, send, isLive } = useTeacherStage('model');
  const released = perClass.released === true;
  const connected = roster.filter((s) => s.connected);
  const step1Done = connected.filter((s) => perStudent[s.name]?.step1At != null).length;
  const passed = connected.filter((s) => perStudent[s.name]?.passed === true).length;

  return (
    <Page
      template="focus"
      title={`特征 × 权重 = 得分（线 ${LINE}）`}
      hint={`第一步 ${step1Done}/${connected.length} · 验证通过 ${passed}/${connected.length}`}
    >
      <Page.Main>
        <Scroll>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={textCell}>短信</th>
                <th style={cell}>类型</th>
                {FEATURES.map((f) => (
                  <th key={f.key} style={cell}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MESSAGES.map((m) => (
                <tr key={m.id}>
                  <td style={textCell}>{m.text}</td>
                  <td style={cell}>
                    <Chip tone={m.scam ? 'bad' : 'good'}>{m.scam ? '诈骗' : '正常'}</Chip>
                  </td>
                  {FEATURES.map((f) => (
                    <td key={f.key} style={cell}>{m.features.includes(f.key) ? '●' : ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </Page.Main>
      <Page.Actions>
        <Btn variant="accent" disabled={!isLive || released} onClick={() => send('teacher:release', {})}>
          {released ? '已放权' : '放权'}
        </Btn>
      </Page.Actions>
    </Page>
  );
}
