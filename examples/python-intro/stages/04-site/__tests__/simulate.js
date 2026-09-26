import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
let seq = 0;

// 虚拟学生不跑 Pyodide：直接发 §3.6 记录 + 首页状态码的假记录。代码带递增序号以匹配回执；记录不含学生姓名
function fakeRecord() {
  const n = ++seq;
  return {
    code: `# sim-${n}\nfrom flask import Flask\napp = Flask(__name__)\n\n@app.route('/')\ndef home():\n    return '<h1>hi</h1>'\n`,
    stdout: '',
    error: null,
    images: [],
    tests: null,
    runs: 1 + (n % 4),
    ms: 200 + (n % 100),
    homeStatus: n % 8 === 0 ? 500 : 200,
  };
}

function submit(student) {
  const rec = fakeRecord();
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'site' && p.data?.code === rec.code, TIMEOUT);
  student.send('student:submit', rec);
  return ack;
}

export async function play({ students }) {
  await Promise.all(students.map((s) => submit(s)));
}

export function loadAction({ student }) {
  return submit(student);
}
