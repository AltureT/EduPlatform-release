import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
let seq = 0;

// 虚拟学生不跑 Pyodide：直接发 §3.6 形状的假记录。代码带递增序号，确保匹配的是这一次提交的回执；记录不含学生姓名
function fakeRecord() {
  const n = ++seq;
  return {
    code: `# sim-${n}\nfor i in range(1, 4):\n    print(' '.join(f'{j}x{i}={i*j}' for j in range(1, i + 1)))\n`,
    stdout: '1x1=1\n1x2=2 2x2=4\n1x3=3 2x3=6 3x3=9\n',
    error: null,
    images: [],
    tests: null,
    runs: 1 + (n % 5),
    ms: 10 + (n % 40),
  };
}

function submit(student) {
  const rec = fakeRecord();
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'hello' && p.data?.code === rec.code, TIMEOUT);
  student.send('student:submit', rec);
  return ack;
}

export async function play({ students }) {
  await Promise.all(students.map((s) => submit(s)));
}

export function loadAction({ student }) {
  return submit(student);
}
