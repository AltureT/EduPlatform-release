// free-text 原语的模拟课堂片段（契约 §七）：每个虚拟学生为每道题写一段满足 min / max 的文字后提交一次。
// ctx.stageConfig 为加载器合并后的有效 config：stageConfig.id 为阶段 id，stageConfig.options 为校验后的 options。
// loadAction：每次写一份新文字再提交（canChange 缺省 true，每次都触发一次 data.set），收到本人回执即 resolve；
// canChange=false 时第二次起服务端回 error:validation（已提交），以它为回执。
// 调用方没传 ctx（如 e2e-restart.js）时拿不到题目，退化为只写第一题 p1（适用于字符串写法的 prompts）。

const TIMEOUT = 5000;
const FILL = '我觉得这道题的关键在于先弄清楚条件，再一步一步推出结论。';
let seq = 0;

// 满足 min / max 的一段文字（带序号，保证每次不同）
export function makeText(prompt, tag) {
  const head = `${tag} `;
  let t = head + FILL;
  while ([...t].length < (prompt.min ?? 0)) t += FILL;
  return [...t].slice(0, prompt.max ?? 300).join('');
}

export function makeAnswers(options, name) {
  seq += 1;
  return Object.fromEntries(options.prompts.map((p) => [p.id, makeText(p, `${name}#${seq}`)]));
}

const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

// 先挂监听再发送：本人本阶段、内容相同的 stage:my-data，或本事件的 error:validation，先到者为回执
function submit(student, stageId, answers) {
  const { socket } = student;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout(${TIMEOUT}ms) waiting for free-text submit ack`));
    }, TIMEOUT);
    function onData(p) {
      if ((stageId == null || p?.stageId === stageId) && same(p?.data?.answers, answers)) done(p);
    }
    function onError(p) {
      if (p?.event === 'student:freetext-submit') done(p);
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
    student.send('student:freetext-submit', { answers });
  });
}

export async function play({ students, ctx }) {
  const { id, options } = ctx.stageConfig;
  await Promise.all(students.map((s) => submit(s, id, makeAnswers(options, s.name))));
}

export function loadAction({ student, ctx }) {
  if (ctx?.stageConfig?.options) return submit(student, ctx.stageConfig.id, makeAnswers(ctx.stageConfig.options, student.name));
  return submit(student, null, makeAnswers({ prompts: [{ id: 'p1' }] }, student.name));
}
