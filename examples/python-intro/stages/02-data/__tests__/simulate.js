import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
// 1×1 PNG：代替真实出图（虚拟学生不跑 Pyodide）
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let seq = 0;

// 代码带递增序号，确保匹配的是这一次提交的回执；记录不含学生姓名
function fakeRecord() {
  const n = ++seq;
  return {
    code: `# sim-${n}\nimport pandas as pd\nimport matplotlib.pyplot as plt\ndf = pd.read_csv('scores.csv')\ndf[['语文', '数学', '英语']].mean().plot.bar()\nplt.title('各科平均分')\n`,
    stdout: '',
    error: null,
    images: n % 10 === 0 ? [] : [PNG],
    tests: null,
    runs: 1 + (n % 6),
    ms: 500 + (n % 300),
  };
}

function submit(student) {
  const rec = fakeRecord();
  const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === 'data' && p.data?.code === rec.code, TIMEOUT);
  student.send('student:submit', rec);
  return ack;
}

export async function play({ students }) {
  await Promise.all(students.map((s) => submit(s)));
}

export function loadAction({ student }) {
  return submit(student);
}
