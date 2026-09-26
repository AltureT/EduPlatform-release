import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
let seq = 0;

// 虚拟学生不跑 Pyodide / pytest：直接发"全部通过"的假记录（服务端只收全对）。代码带递增序号以匹配回执；记录不含学生姓名
function fakeRecord() {
  const n = ++seq;
  return {
    code: `# sim-${n}\ndef grade(score):\n    if score >= 90:\n        return '优秀'\n    if score >= 60:\n        return '及格'\n    return '不及格'\n`,
    stdout: '',
    error: null,
    images: [],
    tests: { passed: 3, failed: 0, errors: 0, total: 3 },
    runs: 2 + (n % 5),
    ms: 30 + (n % 50),
  };
}

function submit(student) {
  const rec = fakeRecord();
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'tests' && p.data?.code === rec.code, TIMEOUT);
  student.send('student:submit', rec);
  return ack;
}

export async function play({ students }) {
  await Promise.all(students.map((s) => submit(s)));
}

export function loadAction({ student }) {
  return submit(student);
}
