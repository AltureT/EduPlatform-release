#!/usr/bin/env node
// 工作台入口（管理台规格 §2）：npm run manage
// 单实例锁（项目根 .manage.lock）→ 生成随机访问凭据 → 缺 .env 则生成 → 在 127.0.0.1:3900–3909 找空闲端口监听 → 打开浏览器
// 环境变量 MANAGE_PORT（可选，M2）：起始端口，改为在 MANAGE_PORT 起的 10 个端口里找（测试与本地验证用）
// 关闭本窗口 / Ctrl+C / 程序出错时先停平台再退出（平台是本进程的子进程，不做后台运行）；
// 进程无论以何种方式退出，'exit' 里都会同步结束平台子进程并释放锁
// R4（管理台更新规格 §4）：listen 成功后 2 s 静默检查一次更新（缓存 24 小时）；"下载并更新"成功 → 先停平台、释放锁，以退出码 75 退出，
//   入口脚本（班迹工作台.command / 班迹工作台.bat，设 EDU_LAUNCHER=1）见 75 就重新启动工作台；没有 EDU_LAUNCHER（直接 npm run manage）的，最后打印一句"请重新运行"
// 更新子进程正在覆盖文件时关窗口 / Ctrl+C：先等它结束（最多 60 s，它自己屏蔽了这些信号），再停平台退出
// S6：锁被活着的旧工作台持有时，GET 旧窗口的 /api/ping（1 s 超时），按 decideTakeover 判定：
//   本项目工作台、pid 与锁一致、平台已停止且手上没活 → 对锁里的 pid 发结束信号，最多等 10 s 锁释放后正常启动；
//   平台没停 / 正在更新 / 正在恢复重置或下载运行时 → 不接管，按状态提示（takeoverMessage）；ping 不通 / 不是本项目 → 原提示不变。
//   参数 --no-replace（npm run manage -- --no-replace）关闭接管；只有这时才显示"kill <pid> && npm run manage"那段引导
// S12（排障文件与 AI 排障规格 §1.2）：工作台自身起不来（取锁出错、监听失败、端口都被占、创建服务出错）或运行中未捕获异常 →
//   写 排障/<时间>-工作台启动.md，打印"排障文件已写到…"，以退出码 76 退出（入口脚本见 76 不再另写）；文件没写成仍以 1 退出。
//   "已有工作台窗口"这类已有专门提示的不写、仍以 1 退出
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEnv, fillDefaultPassword } from './env-file.js';
import { createManageServer } from './server.js';
import { openBrowser } from './net.js';
import { acquireManageLock, LOCK_FILE, pingManage, decideTakeover, replaceOldManage, takeoverMessage } from './process.js';
import { writeDiagnosis, collectEnvironment, launcherSection } from './diagnosis.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const START_PORT = (() => {
  const n = Number(process.env.MANAGE_PORT);
  return Number.isInteger(n) && n >= 1 && n <= 65526 ? n : 3900;
})();
const PORTS = Array.from({ length: 10 }, (_, i) => START_PORT + i);
const TITLE = '班迹工作台';
const NO_REPLACE = process.argv.slice(2).includes('--no-replace');
const DIAG_EXIT_CODE = 76;
const manageInfo = { port: null, startedAt: Date.now() };

// 写"工作台启动"排障文件；写成了返回 76，没写成返回 1
function startupDiagnosis(message, err) {
  const detail = err ? String(err?.stack ?? err).split('\n') : [];
  const r = writeDiagnosis(ROOT, {
    stage: '工作台启动', message, detail,
    environment: collectEnvironment(ROOT, { manage: manageInfo }),
    sections: [launcherSection(ROOT)],
    log: (m) => console.error(m),
  });
  if (!r) return 1;
  console.error('');
  console.error(`  排障文件已写到 ${r.file}，把它发给 AI 工具就能排查`);
  console.error('');
  return DIAG_EXIT_CODE;
}
function failStartup(message, err) {
  console.error(message);
  process.exit(startupDiagnosis(message, err));
}

process.title = TITLE;
if (process.stdout.isTTY) process.stdout.write(`\x1b]0;${TITLE}\x07`);

// ===== 单实例 =====
let lock;
try {
  lock = await acquireManageLock(ROOT);
} catch (err) {
  failStartup(`工作台无法启动：${err?.message ?? err}`, err);
}
let takeover = { action: 'none', reason: 'no-replace' };
if (!lock.ok && !NO_REPLACE) {
  const pingResult = lock.other.starting ? null : await pingManage(lock.other.port, { timeoutMs: 1000 });
  takeover = decideTakeover({ other: lock.other, pingResult, root: ROOT });
  if (takeover.action === 'replace') {
    console.log('');
    console.log('  检测到之前没关的工作台窗口，正在替换…');
    const next = await replaceOldManage({ pid: takeover.pid, acquire: () => acquireManageLock(ROOT), timeoutMs: 10_000 });
    if (next) lock = next;
    else console.log('  旧窗口 10 秒内没有关闭。');
  }
}
if (!lock.ok) {
  console.log('');
  if (takeover.action === 'busy') {
    console.log(`  ${takeoverMessage(takeover.state)}`);
    console.log('  那个窗口的工作台地址（复制到浏览器打开）：');
    console.log(`  ${lock.other.url ?? `http://127.0.0.1:${lock.other.port}/`}`);
    console.log('');
    process.exit(1);
  }
  if (lock.other.starting) {
    console.log('  另一个工作台窗口正在启动，请稍等片刻后使用那个窗口打开的页面。');
  } else {
    console.log('  这个平台文件夹已经有一个工作台窗口在运行了，请直接使用它。');
    console.log('  工作台地址（复制到浏览器打开）：');
    console.log(`  ${lock.other.url ?? `http://127.0.0.1:${lock.other.port}/`}`);
    if (NO_REPLACE && lock.other.pid) {
      console.log('');
      console.log('  刚更新过平台、想换成新版本？先关掉旧窗口再启动（复制整行运行）：');
      console.log(process.platform === 'win32'
        ? `  taskkill /PID ${lock.other.pid} /F && npm run manage`
        : `  kill ${lock.other.pid} && npm run manage`);
    }
  }
  console.log(`  （如果确定没有别的工作台窗口，删除平台文件夹里的 ${LOCK_FILE} 文件后再试）`);
  console.log('');
  process.exit(1);
}

let manage = null;
process.on('exit', () => {
  manage?.killChildrenNow();
  lock.release();
});

const token = crypto.randomBytes(24).toString('base64url');
const UPDATED_EXIT_CODE = 75;
let srv;
try {
  const { created } = ensureEnv(ROOT);
  if (created) console.log('已生成配置文件 .env（教师密码默认 123456，可在工作台 平台 → 设置 里改）');
  else fillDefaultPassword(ROOT); // S14：已装过、密码为空 → 补成默认 123456 并记一行日志
  srv = createManageServer({ root: ROOT, token, onUpdated: () => shutdown('平台已更新', UPDATED_EXIT_CODE) });
} catch (err) {
  failStartup(`工作台无法启动：${err?.message ?? err}`, err);
}
manage = srv;
let listening = false;
for (const port of PORTS) {
  try {
    await srv.listen(port);
    listening = true;
    lock.update({ port, url: srv.url });
    break;
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') failStartup(`工作台无法启动：${err?.message ?? err}`, err);
  }
}
if (!listening) failStartup(`工作台无法启动：端口 ${PORTS[0]}–${PORTS.at(-1)} 都被占用了。请关掉其它工作台窗口后再试。`);
manageInfo.port = Number(new URL(manage.url).port);

console.log('');
console.log('========================================');
console.log(`  ${TITLE}已打开`);
console.log('========================================');
console.log('');
console.log('  如果浏览器没有自动打开，请复制下面的地址到浏览器：');
console.log(`  ${manage.url}`);
console.log('');
console.log('  注意：关闭本窗口即关闭平台。上课期间请保持本窗口开着（可以最小化）。');
console.log('');

let exiting = false;
async function shutdown(reason, code = 0) {
  if (exiting) return;
  exiting = true;
  console.log(`\n正在关闭平台（${reason}）…`);
  const bye = () => {
    if (code === UPDATED_EXIT_CODE && process.env.EDU_LAUNCHER !== '1') {
      console.log('');
      console.log('平台已更新，请重新运行 npm run manage（依赖有变化时先 npm install）');
    }
    process.exit(code);
  };
  if (manage.isUpdating()) {
    console.log('正在更新平台文件，等它完成（最多 1 分钟）…');
    await manage.waitForUpdate(60_000);
  }
  const force = setTimeout(bye, 12000);
  try {
    await manage.close();
  } catch (err) {
    console.error(err?.message ?? err);
  }
  clearTimeout(force);
  bye();
}
// SIGHUP：Mac 关闭终端窗口；Windows 关闭控制台窗口时 Node 也以 SIGHUP 通知
// SIGTERM：新窗口接管（S6）或手动 kill <pid>，原因写中性
const REASONS = { SIGINT: '收到 Ctrl+C', SIGTERM: '收到结束信号（可能是新开的工作台窗口替换了它）', SIGHUP: '窗口关闭' };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(REASONS[sig]));
// 工作台自身出错：先停平台再退出，不留下无人管理的平台进程
const onFatal = (err) => {
  console.error(`工作台出错：${err?.stack ?? err}`);
  if (exiting) return;
  let code = 1;
  try {
    code = startupDiagnosis(`工作台出错：${err?.message ?? err}`, err);
  } catch {
    // 写排障文件本身出错：照常以 1 退出
  }
  shutdown('工作台出错', code);
};
process.on('uncaughtException', onFatal);
process.on('unhandledRejection', onFatal);

srv.scheduleUpdateCheck().catch(() => {});

const opened = await openBrowser(manage.url);
if (!opened) console.log('  （没能自动打开浏览器，请手动复制上面的地址）');
