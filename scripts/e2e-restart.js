#!/usr/bin/env node
// 重启持久化验证（规格 §10；AF verify_restart_persistence 骨架；协议见规格 §5.2 / §6.1 / §8）
//   node scripts/e2e-restart.js [--lesson <path>] [--students N] [--keep-db] [--port P]      N 默认 3
// 阶段一：起服务 → 教师 + N 学生（固定 deviceId）→ 推进到 lesson.config.stages[0] → 每学生调 loadAction 两次 →
//   独立教师连接读 teacher:join-ok { state, stageData } → stop()（SIGTERM）→ 只读打开 dbPath 取快照
// 阶段二：同 dbPath 再起 → 教师 join 读 { state, stageData } → 学生以同一 deviceId 重连读 student:join-ok →
//   stop() → 只读打开 dbPath 取快照
// 断言：state.stage / stageIndex / subPhase、stageData[stageId]、state.students[].enteredStageIndex 前后一致；
//   DB 中 stage_student_data 行数与 students.entered_stage_at / entered_stage_index 前后一致；
//   学生重连 myStageData[stageId] 等于教师 stageData[stageId].perStudent[name]
// 前置检查：阶段一确实停在 stages[0]，且教师 stageData[stageId].perStudent 含全部 N 名学生（防止空数据下"一致"）
// 退出码：0 全部一致；1 任一不一致或流程失败
// 约定：不导入名单，学生按自由起名加入；每次 loadAction 5 s 超时，超时算流程失败
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { spawnServer as realSpawnServer } from '#kernel/test-utils/spawnServer.js';
import { teacherToken } from '#kernel/test-utils/teacherToken.js';
import { virtualStudent } from '#kernel/test-utils/virtualStudent.js';
import { virtualTeacher } from '#kernel/test-utils/virtualTeacher.js';
import { parseArgs } from './lib/args.js';
import { importStageSimulate, lessonConfigPath, loadLesson as realLoadLesson } from './lib/lesson.js';
import { observeStudentJoin, observeTeacher, readDbSnapshot } from './lib/observe.js';
import { EXIT, formatTable, resultLine } from './lib/report.js';
import { disconnectAll, errMsg, randomPassword, removeDbFiles, runIfMain, tempDbPath, withTimeout } from './lib/session.js';

const LOAD_ACTIONS_PER_STUDENT = 2;
const CALL_TIMEOUT_MS = 5000;

const show = (v) => {
  const s = v === undefined ? 'undefined' : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
};

function compareRow(label, left, right) {
  const same = isDeepStrictEqual(left, right);
  return { same, row: [label, show(left), show(right), same ? '一致' : '不一致'] };
}

const enteredIndex = (state, name) => state.students?.find((s) => s.name === name)?.enteredStageIndex;
const dbEntered = (snap, name) => {
  const s = snap.students[name];
  return s ? [s.enteredStageAt, s.enteredStageIndex] : undefined;
};

export async function main(argv, deps = {}) {
  const { spawnServer = realSpawnServer, loadLesson = realLoadLesson, log = console.log } = deps;
  const finish = (code) => {
    log(resultLine(code));
    return code;
  };

  let opts;
  let configPath;
  let stage;
  let loadAction;
  try {
    opts = parseArgs(argv, { defaultStudents: 3 });
    configPath = lessonConfigPath();
    const lesson = await loadLesson(configPath);
    stage = lesson.stages[0];
    if (!stage) throw new Error('lesson.config.stages 为空');
    ({ loadAction } = await importStageSimulate(stage));
    if (typeof loadAction !== 'function') throw new Error(`${stage.id}/__tests__/simulate.js 未导出 loadAction`);
  } catch (err) {
    log(`[e2e-restart] 准备失败：${errMsg(err)}`);
    return finish(EXIT.FAIL);
  }
  log(`[e2e-restart] lesson=${configPath} stage=${stage.id} students=${opts.students} port=${opts.port}`);

  const stageId = stage.id;
  const dbPath = tempDbPath('e2e-restart');
  const password = randomPassword();
  const env = { TEACHER_PASSWORD: password };
  const people = Array.from({ length: opts.students }, (_, i) => ({ name: `重启${i + 1}`, deviceId: randomUUID() }));
  let server = null;
  let handles = [];

  try {
    // —— 阶段一 ——
    log('[e2e-restart] 阶段一：起服务 → 推进到 stages[0] → loadAction × 2 → SIGTERM');
    server = await spawnServer({ port: opts.port, dbPath, env });
    const token1 = await teacherToken(server.base, password);
    const teacher1 = await virtualTeacher(server.base, token1);
    handles.push(teacher1);
    const students1 = [];
    for (const p of people) {
      const s = await virtualStudent(server.base, p.name, { deviceId: p.deviceId });
      students1.push(s);
      handles.push(s);
    }
    await teacher1.advance();
    for (const student of students1) {
      for (let i = 0; i < LOAD_ACTIONS_PER_STUDENT; i++) {
        await withTimeout(loadAction({ student }), CALL_TIMEOUT_MS, `${student.name} loadAction`);
      }
    }
    const before = await observeTeacher({ base: server.base, token: token1 });
    await server.stop(); // SIGTERM；连接保持到服务端退出
    server = null;
    disconnectAll(handles);
    handles = [];
    const dbBefore = readDbSnapshot(dbPath);

    const pre = [];
    if (before.state.stage !== stageId) pre.push(`阶段一未停在 ${stageId}（实际 ${before.state.stage}）`);
    const recorded = Object.keys(before.stageData?.[stageId]?.perStudent ?? {});
    const missing = people.map((p) => p.name).filter((n) => !recorded.includes(n));
    if (missing.length) pre.push(`阶段一教师 stageData.${stageId}.perStudent 缺少：${missing.join('、')}`);
    if (pre.length) {
      for (const m of pre) log(`[e2e-restart] 前置检查失败：${m}`);
      return finish(EXIT.FAIL);
    }

    // —— 阶段二 ——
    log('[e2e-restart] 阶段二：同 dbPath 重启 → 教师 join → 学生重连');
    server = await spawnServer({ port: opts.port, dbPath, env });
    const token2 = await teacherToken(server.base, password);
    const after = await observeTeacher({ base: server.base, token: token2 });
    const rejoins = [];
    for (const p of people) rejoins.push(await observeStudentJoin({ base: server.base, ...p }));
    await server.stop();
    server = null;
    const dbAfter = readDbSnapshot(dbPath);

    const results = [
      compareRow('stage', before.state.stage, after.state.stage),
      compareRow('stageIndex', before.state.stageIndex, after.state.stageIndex),
      compareRow('subPhase', before.state.subPhase, after.state.subPhase),
      compareRow(`stageData.${stageId}`, before.stageData?.[stageId], after.stageData?.[stageId]),
    ];
    for (const { name } of people) {
      results.push(compareRow(`${name}.enteredStageIndex`, enteredIndex(before.state, name), enteredIndex(after.state, name)));
    }
    results.push(compareRow('DB stage_student_data 行数', dbBefore.stageStudentRows, dbAfter.stageStudentRows));
    for (const { name } of people) {
      results.push(compareRow(`DB ${name}.entered_stage_*`, dbEntered(dbBefore, name), dbEntered(dbAfter, name)));
    }
    people.forEach(({ name }, i) => {
      results.push(compareRow(
        `${name}.myStageData`,
        after.stageData?.[stageId]?.perStudent?.[name],
        rejoins[i].myStageData?.[stageId],
      ));
    });

    log('');
    log(formatTable(['项', '重启前', '重启后', '结论'], results.map((r) => r.row)));
    log('（myStageData 行：左列为重启后教师 stageData 中该生记录，右列为学生重连 join-ok 的 myStageData）');
    log('（DB entered_stage_* 行：[entered_stage_at, entered_stage_index]）');
    log('');
    return finish(results.every((r) => r.same) ? EXIT.OK : EXIT.FAIL);
  } catch (err) {
    log(`[e2e-restart] 流程失败：${errMsg(err)}`);
    return finish(EXIT.FAIL);
  } finally {
    disconnectAll(handles);
    if (server) await server.stop().catch(() => {});
    if (opts.keepDb) log(`[e2e-restart] DB: ${dbPath}`);
    else removeDbFiles(dbPath);
  }
}

runIfMain(import.meta.url, main);
