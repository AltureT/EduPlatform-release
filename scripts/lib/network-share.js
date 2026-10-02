// S19 Windows 兼容收尾规格 §4：平台文件夹是不是在网络共享里（虚拟机共享的 Mac 文件夹、NAS、网络盘）——SQLite 在共享上保存不稳，工作台提醒一句
//   detectNetworkShare({ root, env = process.env, platform = process.platform, run, realpath })
//     → Promise<null | { kind: 'unc' | 'network-drive' | 'volume', path }>
//   1. env.EDU_START（入口 .bat 双击时的原始文件夹，UNC 仍是 \\…）以 \\ 开头 → unc；root 本身以 \\ 开头同样算 unc
//   2. win32 且 root 是盘符路径：run('powershell', ['-NoProfile', '-Command', …]) 查 Win32_LogicalDisk 的 DriveType，4 → network-drive
//      （pushd 把 UNC 映射出来的盘符就是这种）；查不出、超时、出错 → 跳过
//   3. darwin：realpath(root) 以 /Volumes/ 开头 → volume（和 diagnosis.js 的 isRemote 同口径；本机外接硬盘也算，可接受）
//   任何异常都返回 null，不抛。run / realpath 可注入（测试用）
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const RUN_TIMEOUT_MS = 5000;

function defaultRun(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout) => (err ? reject(err) : resolve(String(stdout ?? ''))));
  });
}

const isUnc = (p) => typeof p === 'string' && p.startsWith('\\\\');

async function driveType(drive, run) {
  try {
    const cmd = `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").DriveType`;
    const out = await run('powershell', ['-NoProfile', '-Command', cmd], { timeout: RUN_TIMEOUT_MS, windowsHide: true });
    const n = Number.parseInt(String(out ?? '').trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function detectNetworkShare({
  root, env = process.env, platform = process.platform, run = defaultRun, realpath = fs.realpathSync.native,
} = {}) {
  try {
    const start = env?.EDU_START;
    if (isUnc(start)) return { kind: 'unc', path: start };
    if (isUnc(root)) return { kind: 'unc', path: root };
    if (platform === 'win32') {
      const m = /^([A-Za-z]):/.exec(String(root ?? ''));
      if (m && (await driveType(`${m[1].toUpperCase()}:`, run)) === 4) return { kind: 'network-drive', path: root };
      return null;
    }
    if (platform === 'darwin') {
      const real = realpath(root);
      if (typeof real === 'string' && real.startsWith('/Volumes/')) return { kind: 'volume', path: real };
    }
    return null;
  } catch {
    return null;
  }
}
