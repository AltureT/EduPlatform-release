import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
let seq = 0;

// 先挂监听再发送；文本带递增序号，确保匹配的是这一次写入的回执。文本不含学生姓名（契约 §三 v0.5.1：记录不得含身份信息）
function write(student) {
  const text = `答-${++seq}`;
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'freeform' && p.data?.text === text, TIMEOUT);
  student.send('student:write', { text });
  return ack;
}

export async function play({ students }) {
  await Promise.all(students.map((s) => write(s)));
}

export function loadAction({ student }) {
  return write(student);
}
