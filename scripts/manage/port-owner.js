// 端口占用者判定（管理台规格 §4.2、§7.3，M2）：启动前端口被占时，查出是谁占的，给教师可操作的提示
//   findPortOwner(port, { root, platform?, run?, readProc?, realpath? }) → { pid, name, ours } | null（查不出来）
//     darwin / linux：lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpc（缺 lsof 时返回 null）；
//       命令行：linux 读 /proc/<pid>/cmdline，否则 ps -p <pid> -o command=；
//       工作目录：linux 读 /proc/<pid>/cwd，否则 lsof -a -p <pid> -d cwd -Fn 的 cwd 行
//     win32：一次 PowerShell 调用（UTF-8 输出，10 s 超时）：Get-NetTCPConnection -LocalPort N -State Listen（含 IPv6，
//       Node 在 Windows 上 listen(port) 只绑 [::]，netstat -p TCP 看不到；且输出不受系统语言影响）取 OwningProcess，
//       Get-CimInstance Win32_Process 取进程 Name 与 CommandLine，ConvertTo-Json 输出；
//       Windows 上拿不到别的进程的工作目录，只认命令行里带本项目根绝对路径的平台（管理台自己启动平台时用绝对路径）
//   isOurPlatform({ root, commandLine | argv, cwd, platform?, realpath? })：脚本必须是命令行里第一个非选项参数（跳过可执行文件
//     与以 - 开头的选项；字符串形式时其后不能再有别的参数），且
//     - 脚本是绝对路径：规范化后必须等于 <本项目根>/kernel/server/index.js（macOS、Windows 忽略大小写）
//     - 脚本是相对路径：按进程工作目录解析后等于上面那个路径；拿不到工作目录则不算
//   stopOwnPlatform(port, pid, { root, ... }) → { ok, stopped } | { ok: false, message }：
//     只结束"此刻占着该端口、且判定为本项目平台"的那个进程；SIGTERM，最多等 5 s 端口释放，仍在则 SIGKILL
//   stopOwnPlatform 在 SIGTERM 等不到端口释放、要 SIGKILL 之前再查一次占用者，仍是同一个进程才强制结束
//   parseLsofListen / parseLsofCwd / parseWinListen：解析命令输出的纯函数
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { probePort } from './net.js';

const SCRIPT = 'kernel/server/index.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 执行命令，返回 stdout 文本；非 0 退出时抛错（err.stdout 保留输出）
export function runText(cmd, args, { timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(Object.assign(err, { stdout: stdout ?? '' }));
      else resolve(stdout ?? '');
    });
  });
}

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function defaultReadProc(pid, what) {
  if (what === 'cmdline') return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  if (what === 'cwd') return fs.readlinkSync(`/proc/${pid}/cwd`);
  throw new Error(`unknown ${what}`);
}

export function parseLsofListen(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('p')) {
      const pid = Number(line.slice(1));
      cur = null;
      if (Number.isInteger(pid) && pid > 0) {
        cur = out.find((o) => o.pid === pid);
        if (!cur) out.push((cur = { pid, command: null }));
      }
    } else if (line.startsWith('c') && cur && cur.command === null) {
      cur.command = line.slice(1);
    }
  }
  return out;
}

export function parseLsofCwd(text) {
  const lines = String(text || '').split(/\r?\n/);
  const i = lines.indexOf('fcwd');
  if (i < 0) return null;
  const n = lines.slice(i + 1).find((l) => l.startsWith('n'));
  return n ? n.slice(1) : null;
}

// Windows PowerShell 输出：{ connections: [{ LocalAddress, LocalPort, OwningProcess }], processes: [{ ProcessId, Name, CommandLine }] }
// PowerShell 5.1 对单个元素可能输出对象而不是数组，两种都接受
export function parseWinListen(text) {
  let j;
  try {
    j = JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const conn = arr(j.connections).find((c) => Number.isInteger(Number(c?.OwningProcess)) && Number(c.OwningProcess) > 0);
  if (!conn) return null;
  const pid = Number(conn.OwningProcess);
  const p = arr(j.processes).find((x) => Number(x?.ProcessId) === pid);
  return { pid, name: p?.Name ?? null, commandLine: p?.CommandLine ?? '' };
}

// 命令行字符串 → 参数（双引号 / 单引号包裹的部分算一个参数；反斜杠不作转义，Windows 路径原样保留）
function tokenize(s) {
  const out = [];
  let cur = '';
  let quote = null;
  let quoted = false;
  for (const ch of String(s ?? '')) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
    } else if (/\s/.test(ch)) {
      if (cur || quoted) out.push(cur);
      cur = '';
      quoted = false;
    } else {
      cur += ch;
    }
  }
  if (cur || quoted) out.push(cur);
  return out;
}

const isAbsolute = (p) => p.startsWith('/') || p.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(p);

export function isOurPlatform({ root, commandLine, argv, cwd, platform = process.platform, realpath = safeRealpath }) {
  const ci = platform === 'win32' || platform === 'darwin';
  const norm = (p) => {
    let s = path.posix.normalize(String(p).replace(/\\/g, '/'));
    if (s.length > 1) s = s.replace(/\/+$/, '');
    return ci ? s.toLowerCase() : s;
  };
  // 取脚本参数：跳过可执行文件与选项，取第一个非选项参数
  let script;
  if (Array.isArray(argv)) {
    script = argv.slice(1).find((a) => !String(a).startsWith('-'));
  } else {
    const t = tokenize(commandLine);
    let i = 1;
    while (i < t.length && t[i].startsWith('-')) i++;
    // ps 的输出不带引号：路径里有空格时拆成了几段，把剩下的拼回去；因此脚本之后不能再有别的参数
    script = t.length > i ? t.slice(i).join(' ') : undefined;
  }
  if (!script || !/(^|[\\/])kernel[\\/]server[\\/]index\.js$/i.test(script)) return false;
  const expected = new Set([root, realpath(root)].map((r) => norm(`${r}/${SCRIPT}`)));
  if (isAbsolute(script)) return expected.has(norm(script)) || expected.has(norm(realpath(script)));
  if (!cwd) return false;
  return [cwd, realpath(cwd)].some((d) => expected.has(norm(`${d}/${script}`)));
}

export async function findPortOwner(port, {
  root, platform = process.platform, run = runText, readProc = defaultReadProc, realpath = safeRealpath,
} = {}) {
  if (platform === 'win32') {
    const n = Number(port);
    if (!Number.isInteger(n)) return null;
    // 整段不含双引号（Node 在 Windows 上给参数加引号时会转义内部双引号，PowerShell 5.1 解析不稳）
    const script = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; '
      + `$c=@(Get-NetTCPConnection -LocalPort ${n} -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess); `
      + "$p=@($c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_) | Select-Object ProcessId,Name,CommandLine }); "
      + '@{connections=$c;processes=$p} | ConvertTo-Json -Compress -Depth 3';
    let out;
    try {
      out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000 });
    } catch {
      return null;
    }
    const w = parseWinListen(out);
    if (!w) return null;
    return { pid: w.pid, name: w.name, ours: isOurPlatform({ root, commandLine: w.commandLine, cwd: null, platform, realpath }) };
  }

  let out;
  try {
    out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  } catch (err) {
    out = err?.stdout ?? ''; // lsof 找不到时退出码 1；缺 lsof（ENOENT）时没有输出
  }
  const [first] = parseLsofListen(out);
  if (!first) return null;
  const { pid } = first;
  let commandLine = '';
  let argv = null;
  let cwd = null;
  if (platform === 'linux') {
    try {
      argv = readProc(pid, 'cmdline').split('\0').filter(Boolean);
      commandLine = argv.join(' ');
    } catch {
      // 退回 ps
    }
    try {
      cwd = readProc(pid, 'cwd');
    } catch {
      // 退回 lsof
    }
  }
  if (!commandLine) {
    try {
      commandLine = (await run('ps', ['-p', String(pid), '-o', 'command='])).trim();
    } catch {
      // 拿不到命令行：按别的程序处理
    }
  }
  if (!cwd) {
    try {
      cwd = parseLsofCwd(await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']));
    } catch {
      // 拿不到工作目录：只能靠命令行里的绝对路径判定
    }
  }
  const name = first.command || (commandLine ? path.basename(commandLine.split(/\s+/)[0]) : null);
  return { pid, name, ours: isOurPlatform({ root, commandLine, argv: argv?.length ? argv : undefined, cwd, platform, realpath }) };
}

const NOT_OURS = '这个进程不是本平台，管理台不能结束它';

export async function stopOwnPlatform(port, pid, {
  root, probe = probePort, kill = (p, sig) => process.kill(p, sig), timeoutMs = 5000, killTimeoutMs = 2000,
  find, ...findOpts
} = {}) {
  const lookup = find ?? ((p) => findPortOwner(p, { root, ...findOpts }));
  if ((await probe(port)) !== 'in-use') return { ok: true, stopped: false };
  const owner = await lookup(port);
  if (!owner || owner.pid !== pid || !owner.ours) return { ok: false, message: NOT_OURS };
  const freed = async (ms) => {
    const end = Date.now() + ms;
    for (;;) {
      if ((await probe(port)) !== 'in-use') return true;
      if (Date.now() > end) return false;
      await sleep(150);
    }
  };
  try {
    kill(pid, 'SIGTERM');
  } catch (err) {
    if (err?.code !== 'ESRCH') return { ok: false, message: '没能结束之前的平台，请关掉运行它的窗口后重试' };
  }
  if (await freed(timeoutMs)) return { ok: true, stopped: true };
  // 强制结束前再确认一次：仍是同一个、判定为本项目的进程占着端口（进程号可能已被复用、端口可能换了主人）
  const again = await Promise.resolve(lookup(port)).catch(() => null);
  if (!again || again.pid !== pid || !again.ours) {
    return { ok: false, message: `之前的平台已退出，但端口 ${port} 仍被占用，请换一个端口或关掉占用它的程序后重试` };
  }
  try {
    kill(pid, 'SIGKILL');
  } catch {
    // 已退出
  }
  if (await freed(killTimeoutMs)) return { ok: true, stopped: true };
  return { ok: false, message: `之前的平台没有退出，端口 ${port} 仍被占用，请换一个端口或重启电脑后再试` };
}
