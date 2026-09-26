// 开放调参 的模拟课堂片段（契约 §七）：npm run simulate / npm run load 调用。
import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
const SETTINGS = [
  { weights: { link: 20, urgent: 20, transfer: 20, identity: 20, reward: 20, askinfo: 20 }, threshold: 60 },
  { weights: { link: 10, urgent: 20, transfer: 30, identity: 30, reward: 40, askinfo: 40 }, threshold: 60 },
];
const PREDICT = { caught: 40, blocked: 3, recallTrend: 'up', precisionTrend: 'same' };

// 先挂监听再发送；检验次数比发送前多 1 即是这一次的回执。第一次不填预测，之后带预测
function testOnce(student, i) {
  const s = SETTINGS[i % SETTINGS.length];
  const before = student.__tuneTests ?? 0;
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'tune' && (p.data?.tests ?? 0) > before, TIMEOUT).then((p) => {
    student.__tuneTests = p.data.tests;
    return p;
  });
  student.send('student:test', { ...s, predict: before > 0 ? PREDICT : {} });
  return ack;
}

export async function play({ students }) {
  await Promise.all(students.map((s, i) => testOnce(s, i)));
}

export function loadAction({ student }) {
  return testOnce(student, student.__tuneTests ?? 0);
}
