// quiz 原语的模拟课堂片段（契约 §七）：每个虚拟学生答完全部题目后提交一次（每题约六成答对）。
// ctx.stageConfig 为加载器合并后的有效 config：stageConfig.id 为阶段 id，stageConfig.options 为服务端完整 options（含 answerKey）。
// showResultTo 为 'reveal' 时本片段不揭晓（揭晓是教师动作，不影响 submitted 门槛）。
// loadAction：quiz 只能提交一次——第一次调用提交并等本人 stage:my-data；之后的调用服务端回 error:validation（已提交），
// 以此作为回执（不再触发 data.set；契约 v0.8.1 §七 允许一次性提交的原语这样做，压测请用 vote / free-text 段）。
// 调用方没传 ctx（如 e2e-restart.js）时拿不到题目，退化为提交空答卷（{}，服务端接受并记 0 分）。

const TIMEOUT = 5000;

function answerFor(item, key, rand) {
  const right = rand() < 0.6;
  if (item.type === 'single') {
    if (right) return key;
    const others = item.choices.map((c) => c.key).filter((k) => k !== key);
    return others[Math.floor(rand() * others.length)];
  }
  if (item.type === 'truefalse') return right ? key : !key;
  return right ? key[0] : '不知道';
}

export function makeAnswers(options, rand = Math.random) {
  const out = {};
  if (!options.answerKey) return out;
  for (const it of options.items) out[it.id] = answerFor(it, options.answerKey[it.id], rand);
  return out;
}

// 先挂监听再发送：本人本阶段 stage:my-data（带 submittedAt）或本事件的 error:validation，先到者为回执
function submit(student, stageId, answers) {
  const { socket } = student;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout(${TIMEOUT}ms) waiting for quiz submit ack`));
    }, TIMEOUT);
    function onData(p) {
      if ((stageId == null || p?.stageId === stageId) && p?.data?.submittedAt != null) done(p);
    }
    function onError(p) {
      if (p?.event === 'student:quiz-submit') done(p);
    }
    function done(p) {
      cleanup();
      resolve(p);
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off('stage:my-data', onData);
      socket.off('error:validation', onError);
    }
    socket.on('stage:my-data', onData);
    socket.on('error:validation', onError);
    student.send('student:quiz-submit', { answers });
  });
}

export async function play({ students, ctx }) {
  const { id, options } = ctx.stageConfig;
  await Promise.all(students.map((s) => submit(s, id, makeAnswers(options))));
}

export function loadAction({ student, ctx }) {
  if (ctx?.stageConfig?.options) return submit(student, ctx.stageConfig.id, makeAnswers(ctx.stageConfig.options));
  return submit(student, null, {});
}
