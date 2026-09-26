// code 原语的模拟课堂片段（契约 §七）：虚拟学生不跑 Pyodide / pytest，直接发一条沙盒形状的记录。
// ctx.stageConfig 为加载器合并后的有效 config：有 tests 时发"测试全过"的记录（total = 测试文件数，至少 1），
// 否则发"运行无报错"的记录——都满足缺省门槛。代码带递增序号，按它匹配本人本阶段的回执；记录不含学生姓名。
// loadAction：调用方没传 ctx 时匹配任意阶段的回执、发无 tests 的记录。
// P3：自动记录之后每人再"上交最终稿"一次（student:code-final，等到回执里有 final 且代码一致）。
import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;
let seq = 0;

function fakeRecord(stageConfig) {
  const n = ++seq;
  const tests = stageConfig?.sandbox?.tests;
  const total = tests ? Math.max(1, Object.keys(tests).length) : 0;
  return {
    code: `# sim-${n}\ndef solve():\n    return ${n}\n\n\nif __name__ == '__main__':\n    print(solve())\n`,
    stdout: `${n}\n`,
    error: null,
    images: [],
    tests: total > 0 ? { passed: total, failed: 0, errors: 0, total } : null,
    runs: 1 + (n % 4),
    ms: 20 + (n % 40),
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
  student.send('student:code-submit', rec);
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
  student.send('student:code-final', rec);
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
