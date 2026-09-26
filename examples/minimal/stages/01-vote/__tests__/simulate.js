import { waitForMatching } from '#kernel/test-utils/index.js';

const CHOICES = ['A', 'B', 'C', 'D'];
const TIMEOUT = 5000;

const pick = () => CHOICES[Math.floor(Math.random() * CHOICES.length)];

// 先挂监听再发送，收到本人本阶段的 stage:my-data 即 resolve
function vote(student, choice) {
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'vote' && p.data?.choice === choice, TIMEOUT);
  student.send('student:vote', { choice });
  return ack;
}

export async function play({ students }) {
  await Promise.all(students.map((s) => vote(s, pick())));
}

export function loadAction({ student }) {
  return vote(student, pick());
}
