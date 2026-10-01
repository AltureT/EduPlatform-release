#!/usr/bin/env node
// 压测（规格 §10；AF load_test 骨架）
//   node scripts/load.js [N] [--lesson <path>] [--keep-db] [--port P]      N 默认 50（也可 --students N）
// 流程：起服务 → 教师 + N 学生 → 推进到 lesson.config.stages[0] → 5 轮：N 个学生并发调用该阶段
//   loadAction({ student, ctx })（v0.8 起带 ctx = { lessonConfig, stageConfig, base }，与 play 同形；原语的片段靠它拿阶段 id 与 options），
//   计时从调用到 Promise resolve（即收到本人 stage:my-data）→ P50 / P95 / P99 / max
// 退出码：P95 < 200 ms 且无失败调用为 0，否则 1（含参数错误、起服务 / 加入失败）
// 约定：
//   - 不导入名单，学生按自由起名加入
//   - 每次 loadAction 5 s 超时；reject 或超时都记为失败调用，任一失败即退出 1
import { performance } from 'node:perf_hooks';
import { spawnServer as realSpawnServer } from '#kernel/test-utils/spawnServer.js';
import { teacherToken } from '#kernel/test-utils/teacherToken.js';
import { virtualStudent } from '#kernel/test-utils/virtualStudent.js';
import { virtualTeacher } from '#kernel/test-utils/virtualTeacher.js';
import { parseArgs, resolvePort } from './lib/args.js';
import { importStageSimulate, lessonConfigPath, loadLesson as realLoadLesson } from './lib/lesson.js';
import { EXIT, formatTable, percentile, resultLine } from './lib/report.js';
import { disconnectAll, errMsg, randomPassword, removeDbFiles, runIfMain, tempDbPath, withTimeout } from './lib/session.js';

export const ROUNDS = 5;
export const PASS_P95_MS = 200;
const CALL_TIMEOUT_MS = 5000;
const MAX_ERRORS_SHOWN = 5;

const fmt = (v) => (v === null ? '—' : String(Math.round(v)));

export async function main(argv, deps = {}) {
  const { spawnServer = realSpawnServer, loadLesson = realLoadLesson, log = console.log, probePort } = deps;
  const finish = (code) => {
    log(resultLine(code));
    return code;
  };

  let opts;
  let configPath;
  let stage;
  let lessonConfig;
  let loadAction;
  try {
    opts = parseArgs(argv, { defaultStudents: 50 });
    opts.port = await resolvePort(opts, { probe: probePort }); // S6：没给 --port 时探测空闲端口，避开 3001 / 3900–3909
    configPath = lessonConfigPath();
    const lesson = await loadLesson(configPath);
    stage = lesson.stages[0];
    lessonConfig = lesson.lessonConfig;
    if (!stage) throw new Error('lesson.config.stages 为空');
    ({ loadAction } = await importStageSimulate(stage));
    if (typeof loadAction !== 'function') throw new Error(`${stage.id}/__tests__/simulate.js 未导出 loadAction`);
  } catch (err) {
    log(`[load] 准备失败：${errMsg(err)}`);
    return finish(EXIT.FAIL);
  }
  log(`[load] lesson=${configPath} stage=${stage.id} N=${opts.students} rounds=${ROUNDS} port=${opts.port}`);

  const dbPath = tempDbPath('load');
  const password = randomPassword();
  let server = null;
  let teacher = null;
  let students = [];

  try {
    try {
      server = await spawnServer({ port: opts.port, dbPath, env: { TEACHER_PASSWORD: password } });
      const token = await teacherToken(server.base, password);
      teacher = await virtualTeacher(server.base, token);
      const names = Array.from({ length: opts.students }, (_, i) => `压测${String(i + 1).padStart(3, '0')}`);
      const t0 = performance.now();
      const settled = await Promise.allSettled(names.map((n) => virtualStudent(server.base, n)));
      students = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
      const joinErrors = settled.filter((s) => s.status === 'rejected').map((s) => errMsg(s.reason));
      log(`[load] 已连接 ${students.length}/${names.length}，${Math.round(performance.now() - t0)} ms`);
      if (joinErrors.length) throw new Error(`${joinErrors.length} 名学生加入失败：${joinErrors.slice(0, MAX_ERRORS_SHOWN).join('；')}`);
      await teacher.advance();
    } catch (err) {
      log(`[load] 起服务 / 加入失败：${errMsg(err)}`);
      return finish(EXIT.FAIL);
    }

    const ctx = { lessonConfig, stageConfig: stage.config, base: server.base };
    const all = [];
    const errors = [];
    const rounds = [];
    for (let round = 1; round <= ROUNDS; round++) {
      const roundStart = performance.now();
      const settled = await Promise.allSettled(students.map(async (student) => {
        const start = performance.now();
        await withTimeout(loadAction({ student, ctx }), CALL_TIMEOUT_MS, `${student.name} loadAction`);
        return performance.now() - start;
      }));
      const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
      for (const s of settled) if (s.status === 'rejected') errors.push(errMsg(s.reason));
      all.push(...ok);
      rounds.push([
        round,
        `${ok.length}/${students.length}`,
        fmt(performance.now() - roundStart),
        fmt(percentile(ok, 0.5)),
        fmt(percentile(ok, 0.95)),
        fmt(ok.length ? Math.max(...ok) : null),
      ]);
    }

    const total = students.length * ROUNDS;
    const p95 = percentile(all, 0.95);
    log('');
    log(formatTable(['轮次', '成功', '本轮 ms', 'P50', 'P95', 'max'], rounds));
    log('');
    log(formatTable(
      ['成功', 'P50', 'P95', 'P99', 'max', '阈值'],
      [[`${all.length}/${total}`, fmt(percentile(all, 0.5)), fmt(p95), fmt(percentile(all, 0.99)),
        fmt(all.length ? Math.max(...all) : null), `P95 < ${PASS_P95_MS}`]],
    ));
    if (errors.length) {
      log('');
      log(`[load] ${errors.length} 次调用失败，前 ${Math.min(errors.length, MAX_ERRORS_SHOWN)} 条：`);
      for (const e of errors.slice(0, MAX_ERRORS_SHOWN)) log(`  ${e}`);
    }
    log('');
    const pass = errors.length === 0 && p95 !== null && p95 < PASS_P95_MS;
    return finish(pass ? EXIT.OK : EXIT.FAIL);
  } finally {
    disconnectAll([teacher, ...students]);
    if (server) await server.stop().catch(() => {});
    if (opts.keepDb) log(`[load] DB: ${dbPath}`);
    else removeDbFiles(dbPath);
  }
}

runIfMain(import.meta.url, main);
