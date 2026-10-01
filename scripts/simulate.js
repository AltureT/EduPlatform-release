#!/usr/bin/env node
// 模拟课堂（规格 §10；契约 §七）
//   node scripts/simulate.js [--students N] [--lesson <path>] [--keep-db] [--port P]
// 流程：loadLesson(LESSON_CONFIG) → 临时端口 + 临时 DB → spawnServer → teacherToken → virtualTeacher →
//   teacher:import-roster { names }，等 teacher:admin-ok { action:'import-roster' } → N 个 virtualStudent 并发加入 → teacher.advance() 离开 prelogin →
//   对 lesson.config.stages 每个阶段：import <dir>/__tests__/simulate.js，await play({ students, teacher, ctx })，
//   teacher.advance({ force:false })，5 s 内 stage:change 为 gate 通过，teacher:advance-error 为不通过（记录 reason，
//   再 force 推进以跑完全程）→ 到 curtain → 汇总每阶段 play 耗时与 gate 结果
// 退出码：0 全过；1 有 gate 不通过或 play 抛错；2 起服务 / 加入失败（含参数错误、loadLesson 失败、导入名单回 admin-error）
// 约定：
//   - 阶段缺 __tests__/simulate.js 或未导出 play：按 play 抛错处理（退出 1）
//   - 离开 prelogin 的推进失败：退出 2
//   - play 抛错时不做非 force 推进，直接 force 推进
//   - 推进超时后迟到的 stage:change 不做专门处理
import { performance } from 'node:perf_hooks';
import { spawnServer as realSpawnServer } from '#kernel/test-utils/spawnServer.js';
import { teacherToken } from '#kernel/test-utils/teacherToken.js';
import { virtualStudent } from '#kernel/test-utils/virtualStudent.js';
import { virtualTeacher } from '#kernel/test-utils/virtualTeacher.js';
import { parseArgs, resolvePort } from './lib/args.js';
import { importStageSimulate, lessonConfigPath, loadLesson as realLoadLesson } from './lib/lesson.js';
import { EXIT, formatTable, resultLine } from './lib/report.js';
import {
  disconnectAll, errMsg, randomPassword, removeDbFiles, runIfMain, tempDbPath, waitAdminAck,
} from './lib/session.js';

export function studentNames(n) {
  return Array.from({ length: n }, (_, i) => `学生${i + 1}`);
}

export async function main(argv, deps = {}) {
  const { spawnServer = realSpawnServer, loadLesson = realLoadLesson, log = console.log, probePort } = deps;
  const finish = (code) => {
    log(resultLine(code));
    return code;
  };

  let opts;
  let lesson;
  let configPath;
  try {
    opts = parseArgs(argv, { defaultStudents: 30 });
    opts.port = await resolvePort(opts, { probe: probePort }); // S6：没给 --port 时探测空闲端口，避开 3001 / 3900–3909
    configPath = lessonConfigPath();
    lesson = await loadLesson(configPath);
  } catch (err) {
    log(`[simulate] 准备失败：${errMsg(err)}`);
    return finish(EXIT.SETUP);
  }
  log(`[simulate] lesson=${configPath} students=${opts.students} port=${opts.port}`);

  const dbPath = tempDbPath('simulate');
  const password = randomPassword();
  let server = null;
  let teacher = null;
  let students = [];
  const records = [];
  let failed = false;

  try {
    // —— 起服务 / 加入：任何失败退出 2 ——
    try {
      server = await spawnServer({ port: opts.port, dbPath, env: { TEACHER_PASSWORD: password } });
      const token = await teacherToken(server.base, password);
      teacher = await virtualTeacher(server.base, token);
      const names = studentNames(opts.students);
      const rosterAck = waitAdminAck(teacher.socket, 'import-roster');
      teacher.send('teacher:import-roster', { names });
      await rosterAck;
      const settled = await Promise.allSettled(names.map((n) => virtualStudent(server.base, n)));
      students = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
      const rejected = settled
        .map((s, i) => (s.status === 'rejected' ? `${names[i]}：${errMsg(s.reason)}` : null))
        .filter(Boolean);
      if (rejected.length) {
        log(`[simulate] ${rejected.length}/${names.length} 名学生加入失败：`);
        for (const r of rejected) log(`  ${r}`);
        return finish(EXIT.SETUP);
      }
      log(`[simulate] ${students.length} 名学生已加入`);
      await teacher.advance();
    } catch (err) {
      log(`[simulate] 起服务 / 加入失败：${errMsg(err)}`);
      return finish(EXIT.SETUP);
    }

    // —— 逐阶段 play → gate ——
    let aborted = false;
    for (const stage of lesson.stages) {
      const rec = { id: stage.id, label: stage.config?.label ?? '', playMs: 0, result: '', reason: '' };
      records.push(rec);
      let playOk = true;
      const t0 = performance.now();
      try {
        const sim = await importStageSimulate(stage);
        if (typeof sim.play !== 'function') throw new Error('__tests__/simulate.js 未导出 play');
        const ctx = { lessonConfig: lesson.lessonConfig, stageConfig: stage.config, base: server.base };
        await sim.play({ students, teacher, ctx });
      } catch (err) {
        playOk = false;
        rec.result = 'play 抛错';
        rec.reason = errMsg(err);
      }
      rec.playMs = Math.round(performance.now() - t0);

      if (playOk) {
        try {
          await teacher.advance({ force: false });
          rec.result = '通过';
          continue;
        } catch (err) {
          rec.result = '不通过';
          rec.reason = errMsg(err);
        }
      }
      failed = true;
      try {
        await teacher.advance({ force: true });
      } catch (err) {
        rec.reason += `；force 推进失败：${errMsg(err)}`;
        aborted = true;
        break;
      }
    }

    log('');
    log(formatTable(
      ['阶段', '名称', 'play ms', 'gate', '说明'],
      records.map((r) => [r.id, r.label, r.playMs, r.result, r.reason]),
    ));
    log('');
    if (aborted) log('[simulate] 推进中断，未到达 curtain');
    else log('[simulate] 已到达 curtain');
    return finish(failed ? EXIT.FAIL : EXIT.OK);
  } finally {
    disconnectAll([teacher, ...students]);
    if (server) await server.stop().catch(() => {});
    if (opts.keepDb) log(`[simulate] DB: ${dbPath}`);
    else removeDbFiles(dbPath);
  }
}

runIfMain(import.meta.url, main);
