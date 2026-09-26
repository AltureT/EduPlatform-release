// 集体拦截 的模拟课堂片段（契约 §七）：npm run simulate / npm run load 调用。
import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
const SETTINGS = [
  { weights: { link: 20, urgent: 20, transfer: 20, identity: 20, reward: 20, askinfo: 20 }, threshold: 60 },
  { weights: { link: 10, urgent: 20, transfer: 30, identity: 30, reward: 40, askinfo: 40 }, threshold: 60 },
];

// 先挂监听再发送；ranAt 比发送前晚即是这一次的回执（虚拟学生直接发一组设置，代替学生页自动发送）
function run(student, i) {
  const before = Date.now();
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'intercept' && (p.data?.ranAt ?? 0) >= before, TIMEOUT);
  student.send('student:run', SETTINGS[i % SETTINGS.length]);
  return ack;
}

export async function play({ students }) {
  await Promise.all(students.map((s, i) => run(s, i)));
}

let seq = 0;
export function loadAction({ student }) {
  return run(student, ++seq);
}
