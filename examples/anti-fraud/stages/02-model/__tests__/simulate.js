// 体验 + 建模 的模拟课堂片段（契约 §七）：npm run simulate / npm run load 调用。
import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
const GOOD = { link: 10, urgent: 10, transfer: 20, identity: 30, reward: 40, askinfo: 30 };
const STEP1 = ['link', 'identity', 'askinfo'];

// 先挂监听再发送，收到本人本阶段且满足条件的 stage:my-data 即 resolve
function sendAndWait(student, event, payload, match) {
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'model' && match(p.data ?? {}), TIMEOUT);
  student.send(event, payload);
  return ack;
}

export async function play({ students, teacher }) {
  // 教师放权；放权会给每个学生记录写 releasedAt，以此为回执
  const released = students.map((s) => waitForMatching(s.socket, 'stage:my-data', (p) => p?.stageId === 'model' && p.data?.releasedAt != null, TIMEOUT));
  teacher.send('teacher:release', {});
  await Promise.all(released);
  await Promise.all(
    students.map(async (s) => {
      await sendAndWait(s, 'student:pick', { features: STEP1 }, (d) => d.step1At != null);
      await sendAndWait(s, 'student:verify', { weights: GOOD }, (d) => d.passed === true);
    }),
  );
}

// 压测：第一步可重复提交、每次都 data.set（不依赖放权）
let seq = 0;
export function loadAction({ student }) {
  const features = ++seq % 2 ? STEP1 : ['reward'];
  const before = Date.now();
  return sendAndWait(student, 'student:pick', { features }, (d) => (d.step1At ?? 0) >= before);
}
