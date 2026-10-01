#!/usr/bin/env node
// 平台更新子进程（管理台更新规格 §3）：管理台"下载并更新"起它，逐行输出经 SSE 转给页面；也可手动运行
// 用法：node scripts/update-platform.mjs --version <x.y.z> --url <地址1> [--url <地址2>] [--root <平台目录>]
//       node scripts/update-platform.mjs --recover [--root <平台目录>]：手动检查上次更新是否被打断、需要时恢复到更新前
//         （管理台打不开时由技术同事运行；逻辑同管理台启动时：更新程序还在跑 → 不动，退出 1；文件已完好 → 只记完成；否则按备份恢复，失败退出 5）
//   下载到 backups/updates/EduPlatform-v<x.y.z>.zip → 校验 → 备份 → 覆盖 → 验证；失败自动恢复
//   退出码：0 已更新、1 参数或前置不对、2 下载失败、3 包不对、4 失败已恢复、5 恢复也失败（打印备份目录）
// 本文件与它 import 的 scripts/lib/* 会在更新中被新版本覆盖：下面全部是静态 import，进程启动时已全部加载进内存，
//   覆盖开始后不再 import 任何模块（Node 已加载的模块不受磁盘上文件被替换的影响）
// 下载地址只允许 https:。开始校验 / 备份 / 覆盖之前屏蔽 SIGINT / SIGHUP / SIGTERM（Ctrl+C、Mac 关终端窗口、管理台被结束）：
//   覆盖是同步做完的，信号等它（成功或回滚）结束后才被处理，处理函数什么也不做，进程按结果退出；
//   Windows 关控制台窗口拦不住（系统直接结束进程）——靠备份的 done:false 让下次启动管理台时自动恢复
// 仅测试用：EDU_UPDATE_FAIL_AT=<n> 让第 n 次写文件出错（n 大于要写的文件数 → 全部写完后出错），用来测"覆盖自己之后仍能回滚"；
//   EDU_UPDATE_TEST_SIGNAL=<SIGINT|SIGTERM|SIGHUP|SIGKILL> 写完文件后给自己发这个信号（测屏蔽；与 EDU_UPDATE_FAIL_AT 同用时改为写到第 n 个文件时发）；EDU_UPDATE_TEST_ALLOW_FILE=1 允许 file: 地址
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUpdate, recoverInterruptedUpdate, EXIT } from './lib/update-platform.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = '用法：node scripts/update-platform.mjs --version <x.y.z> --url <地址> [--url <备用地址>] [--root <平台目录>]\n'
  + '      node scripts/update-platform.mjs --recover [--root <平台目录>]';

// 管理台先退出时（关窗口）不让写 stdout 的错误打断正在进行的覆盖 / 回滚
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

function parse(argv) {
  const out = { version: null, urls: [], root: path.resolve(HERE, '..'), recover: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--version' && v) { out.version = v; i += 1; }
    else if (a === '--url' && v) { out.urls.push(v); i += 1; }
    else if (a === '--root' && v) { out.root = path.resolve(v); i += 1; }
    else if (a === '--recover') out.recover = true;
    else throw new Error(`不认识的参数：${a}`);
  }
  if (!out.recover && (!out.version || out.urls.length === 0)) throw new Error('缺 --version 或 --url');
  return out;
}

let args;
try {
  args = parse(process.argv.slice(2));
} catch (err) {
  console.log(err.message);
  console.log(USAGE);
  process.exit(EXIT.ERROR);
}

if (args.recover) {
  const r = recoverInterruptedUpdate(args.root, { log: (m) => console.log(m.replace(/^\[update\] /, '')) });
  if (!r) console.log('没有需要恢复的更新（上次更新已完成，或者没有更新过）');
  else if (r.action === 'rolled-back') console.log(`已恢复到更新前（v${r.from}）；更新前的文件备份在：${r.backupDir}`);
  else if (r.action === 'intact') console.log(`平台文件已完好（${r.version ?? '?'} 版），已记下上次更新完成`);
  else if (r.action === 'running') console.log(`更新程序（进程 ${r.pid}）还在运行：等它结束后再运行本命令`);
  else console.log(`恢复没有全部成功：${r.errors.join('；')}\n请重新解压发布包覆盖平台文件夹（课程、课堂数据和设置不会丢）；备份在：${r.backupDir}`);
  process.exit(!r || r.ok ? EXIT.OK : r.action === 'running' ? EXIT.ERROR : EXIT.ROLLBACK_FAILED);
}

const failAt = Number(process.env.EDU_UPDATE_FAIL_AT);
const testSignal = process.env.EDU_UPDATE_TEST_SIGNAL;
let writes = 0;
const testHooks = {};
if (Number.isInteger(failAt) && failAt > 0) {
  testHooks.io = {
    writeFile: (f, data) => {
      writes += 1;
      if (writes === failAt && testSignal) process.kill(process.pid, testSignal); // 写到第 n 个文件时被结束
      else if (writes === failAt) throw new Error(`测试：第 ${failAt} 次写文件出错`);
      fs.writeFileSync(f, data);
    },
  };
}
if (testHooks.io || testSignal) {
  testHooks.afterWrite = () => {
    if (testSignal && !testHooks.io) process.kill(process.pid, testSignal);
    if (testHooks.io && !testSignal && writes < failAt) throw new Error('测试：写完后出错');
  };
}

const SIGNALS = ['SIGINT', 'SIGHUP', 'SIGTERM'];
const holdSignals = () => {
  for (const sig of SIGNALS) {
    process.on(sig, () => console.log(`（收到 ${sig}：正在写文件，写完或恢复完再退出）`));
  }
};

const r = await runUpdate({
  root: args.root, version: args.version, urls: args.urls, log: (m) => console.log(m), now: new Date(),
  beforeApply: holdSignals,
  protocols: process.env.EDU_UPDATE_TEST_ALLOW_FILE === '1' ? ['https:', 'file:'] : ['https:'],
  ...testHooks,
});
process.exitCode = r.code;
