// vote 原语的模拟课堂片段（契约 §七）：每个虚拟学生投一次（多选投 1–2 项）。
// ctx.stageConfig 为加载器合并后的有效 config：stageConfig.id 为阶段 id，stageConfig.options 为校验后的 options。
// 有 answer 时 play 在全部投完后由虚拟教师点"揭晓"（P4；loadAction 不揭晓）。
// loadAction：契约签名只有 { student }，拿不到阶段 id 与 options；调用方传了 ctx 时按 ctx 投，
// 否则按单选投 'A' 并匹配任意阶段的回执（适用于键从 A 开始的单选投票）。
import { waitForMatching } from '#kernel/test-utils/index.js';

const TIMEOUT = 5000;

function pick(options) {
  const keys = options.choices.map((c) => c.key);
  const one = () => keys[Math.floor(Math.random() * keys.length)];
  if (!options.multiple) return one();
  const set = new Set([one()]);
  if (Math.random() < 0.5) set.add(one());
  return keys.filter((k) => set.has(k));
}

const same = (a, b) => JSON.stringify([].concat(a ?? []).sort()) === JSON.stringify([].concat(b ?? []).sort());

// 先挂监听再发送，收到本人本阶段的 stage:my-data 即 resolve（stageId 为 null 时不限阶段）
function vote(student, stageId, choice) {
  const ack = waitForMatching(
    student.socket,
    'stage:my-data',
    (p) => (stageId == null || p?.stageId === stageId) && same(p?.data?.choice, choice),
    TIMEOUT,
  );
  student.send('student:vote', { choice });
  return ack;
}

// 教师点"揭晓"：等到本阶段子阶段变成 reveal（stage:sub-phase { stage, subPhase }）
function reveal(teacher, stageId) {
  const ack = waitForMatching(teacher.socket, 'stage:sub-phase', (p) => p?.stage === stageId && p?.subPhase === 'reveal', TIMEOUT);
  teacher.send('teacher:reveal', {});
  return ack;
}

export async function play({ students, teacher, ctx }) {
  const { id, options } = ctx.stageConfig;
  await Promise.all(students.map((s) => vote(s, id, pick(options))));
  // P4：有 answer 时全部投完后模拟教师"揭晓"，再由 simulate 推进——阶段自写 gate 要求"揭晓之后才能进"（README 门槛进阶）也能过
  if (options.answer && teacher) await reveal(teacher, id);
}

export function loadAction({ student, ctx }) {
  if (ctx?.stageConfig?.options) return vote(student, ctx.stageConfig.id, pick(ctx.stageConfig.options));
  return vote(student, null, 'A');
}
