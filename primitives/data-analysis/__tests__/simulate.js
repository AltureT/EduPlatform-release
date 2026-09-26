// data-analysis 原语的模拟课堂片段（契约 §七）：虚拟学生不跑 Pyodide，直接发一条带 1×1 PNG 的记录（每 10 人里 1 人无图），
// 满足缺省门槛 { image: 0.7 }。代码带递增序号，按它匹配本人本阶段的回执；记录不含学生姓名。
// ctx.stageConfig 为加载器合并后的有效 config（取阶段 id 与数据集路径）；调用方没传 ctx 时匹配任意阶段的回执。
// P3：自动记录之后每人再"上交最终稿"一次（student:data-final，等到回执里有 final 且代码一致）。
import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let seq = 0;

function fakeRecord(stageConfig) {
  const n = ++seq;
  const path = stageConfig?.options?.dataset?.path ?? 'data.csv';
  return {
    code: `# sim-${n}\nimport pandas as pd\nimport matplotlib.pyplot as plt\ndf = pd.read_csv('${path}')\ndf.mean(numeric_only=True).plot.bar()\nplt.show()\n`,
    stdout: '',
    error: null,
    images: n % 10 === 0 ? [] : [PNG],
    tests: null,
    runs: 1 + (n % 6),
    ms: 400 + (n % 300),
  };
}

function submit(student, stageConfig) {
  const rec = fakeRecord(stageConfig);
  const stageId = stageConfig?.id ?? null;
  const ack = waitForMatching(
    student.socket,
    'stage:my-data',
    (p) => (stageId == null || p?.stageId === stageId) && p?.data?.code === rec.code,
    TIMEOUT,
  );
  student.send('student:data-submit', rec);
  return ack;
}

function submitFinal(student, stageConfig, rec) {
  const stageId = stageConfig?.id ?? null;
  const ack = waitForMatching(
    student.socket,
    'stage:my-data',
    (p) => (stageId == null || p?.stageId === stageId) && p?.data?.final?.code === rec.code && p?.data?.finalAt != null,
    TIMEOUT,
  );
  student.send('student:data-final', rec);
  return ack;
}

export async function play({ students, ctx }) {
  await Promise.all(students.map(async (s) => {
    const mine = await submit(s, ctx.stageConfig);
    const { code, stdout, error, images, tests, runs, ms } = mine.data;
    await submitFinal(s, ctx.stageConfig, { code, stdout, error, images, tests, runs, ms });
  }));
}

export function loadAction({ student, ctx }) {
  return submit(student, ctx?.stageConfig ?? null);
}
