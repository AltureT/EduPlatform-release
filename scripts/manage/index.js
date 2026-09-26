#!/usr/bin/env node
// 管理台入口（管理台规格 §2）：npm run manage
// 单实例锁（项目根 .manage.lock）→ 生成随机访问凭据 → 缺 .env 则生成 → 在 127.0.0.1:3900–3909 找空闲端口监听 → 打开浏览器
// 环境变量 MANAGE_PORT（可选，M2）：起始端口，改为在 MANAGE_PORT 起的 10 个端口里找（测试与本地验证用）
// 关闭本窗口 / Ctrl+C / 程序出错时先停平台再退出（平台是本进程的子进程，不做后台运行）；
// 进程无论以何种方式退出，'exit' 里都会同步结束平台子进程并释放锁
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEnv } from './env-file.js';
import { createManageServer } from './server.js';
import { openBrowser } from './net.js';
import { acquireManageLock, LOCK_FILE } from './process.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const START_PORT = (() => {
  const n = Number(process.env.MANAGE_PORT);
  return Number.isInteger(n) && n >= 1 && n <= 65526 ? n : 3900;
})();
const PORTS = Array.from({ length: 10 }, (_, i) => START_PORT + i);
const TITLE = '课堂互动平台';

process.title = TITLE;
if (process.stdout.isTTY) process.stdout.write(`\x1b]0;${TITLE}\x07`);

// ===== 单实例 =====
let lock;
try {
  lock = await acquireManageLock(ROOT);
} catch (err) {
  console.error(`管理台无法启动：${err?.message ?? err}`);
  process.exit(1);
}
if (!lock.ok) {
  console.log('');
  if (lock.other.starting) {
    console.log('  另一个管理台窗口正在启动，请稍等片刻后使用那个窗口打开的页面。');
  } else {
    console.log('  这个平台文件夹已经有一个管理台窗口在运行了，请直接使用它。');
    console.log('  管理台地址（复制到浏览器打开）：');
    console.log(`  ${lock.other.url ?? `http://127.0.0.1:${lock.other.port}/`}`);
    if (lock.other.pid) {
      console.log('');
      console.log('  刚更新过平台、想换成新版本？先关掉旧窗口再启动（复制整行运行）：');
      console.log(process.platform === 'win32'
        ? `  taskkill /PID ${lock.other.pid} /F && npm run manage`
        : `  kill ${lock.other.pid} && npm run manage`);
    }
  }
  console.log(`  （如果确定没有别的管理台窗口，删除平台文件夹里的 ${LOCK_FILE} 文件后再试）`);
  console.log('');
  process.exit(1);
}

let manage = null;
process.on('exit', () => {
  manage?.killChildrenNow();
  lock.release();
});

const token = crypto.randomBytes(24).toString('base64url');
const { created } = ensureEnv(ROOT);
if (created) console.log('已生成配置文件 .env（请在管理台的"设置"里填写教师密码）');

const srv = createManageServer({ root: ROOT, token });
manage = srv;
let listening = false;
for (const port of PORTS) {
  try {
    await srv.listen(port);
    listening = true;
    lock.update({ port, url: srv.url });
    break;
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') {
      console.error(`管理台无法启动：${err?.message ?? err}`);
      process.exit(1);
    }
  }
}
if (!listening) {
  console.error(`管理台无法启动：端口 ${PORTS[0]}–${PORTS.at(-1)} 都被占用了。请关掉其它管理台窗口后再试。`);
  process.exit(1);
}

console.log('');
console.log('========================================');
console.log(`  ${TITLE} · 管理台已打开`);
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
  const force = setTimeout(() => process.exit(code), 12000);
  try {
    await manage.close();
  } catch (err) {
    console.error(err?.message ?? err);
  }
  clearTimeout(force);
  process.exit(code);
}
// SIGHUP：Mac 关闭终端窗口；Windows 关闭控制台窗口时 Node 也以 SIGHUP 通知
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(sig === 'SIGINT' ? '收到 Ctrl+C' : '窗口关闭'));
// 管理台自身出错：先停平台再退出，不留下无人管理的平台进程
const onFatal = (err) => {
  console.error(`管理台出错：${err?.stack ?? err}`);
  shutdown('管理台出错', 1);
};
process.on('uncaughtException', onFatal);
process.on('unhandledRejection', onFatal);

const opened = await openBrowser(manage.url);
if (!opened) console.log('  （没能自动打开浏览器，请手动复制上面的地址）');
