// 网络小工具（管理台规格 §2 net.js、§4.1）
//   lanAddresses(ifaces?) → 局域网 IPv4 列表（规则与 kernel/server/admin.js 的 lanAddresses 保持一致，见下）
//   probePort(port, host?) → 'free' | 'in-use' | 'no-permission' | 'error'；isPortFree(port) → boolean
//   suggestPort(port, { probe? }) → 端口被占时建议改用的空闲端口（< 1024 先试 3001 / 8080，否则往后找 10 个）；没有则 null
//   openBrowser(url) → Promise<boolean>：darwin open / win32 cmd /c start "" / 其它 xdg-open；失败返回 false
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';

// ===== 局域网地址 =====
// 与 kernel/server/admin.js lanAddresses 保持一致（M2：管理台不引用 kernel 的实现，改这里时两处一起改；样例测试见 __tests__/net.test.js）：
// - 只返回私有网段 10/8、172.16/12、192.168/16（因此 169.254/16、198.18/15、100.64/10、回环与公网都不返回）
// - 排序：实体网卡在前、虚拟网卡（utun / feth / zt / docker / vboxnet / vmnet / vEthernet / VirtualBox / VMware）在后；
//   同类里 192.168 > 10 > 172.16/12；再按网卡顺序；去重
const VIRTUAL_IFACE = /^(utun|feth|zt|docker|vboxnet|vmnet|vethernet|virtualbox|vmware)/i;

function privateRank(address) {
  const p = String(address).split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return -1;
  if (p[0] === 192 && p[1] === 168) return 0;
  if (p[0] === 10) return 1;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 2;
  return -1;
}

export function lanAddresses(ifaces = os.networkInterfaces()) {
  const found = [];
  const seen = new Set();
  let order = 0;
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const it of list || []) {
      const v4 = it && (it.family === 'IPv4' || it.family === 4);
      if (!v4 || it.internal || !it.address || seen.has(it.address)) continue;
      const rank = privateRank(it.address);
      if (rank < 0) continue;
      seen.add(it.address);
      found.push({ address: it.address, virtual: VIRTUAL_IFACE.test(name) ? 1 : 0, rank, order: order++ });
    }
  }
  found.sort((x, y) => x.virtual - y.virtual || x.rank - y.rank || x.order - y.order);
  return found.map((f) => f.address);
}

export function probePort(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve('in-use');
      else if (err.code === 'EACCES' || err.code === 'EPERM') resolve('no-permission');
      else resolve('error');
    });
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve('free')));
  });
}

export async function isPortFree(port, host) {
  return (await probePort(port, host)) === 'free';
}

// 建议端口要求"所有地址"与 127.0.0.1 都空闲：macOS 上别的程序只占 127.0.0.1:N 时，监听 [::]:N 仍会成功，
// 平台能起来但管理台的就绪探测会打到那个程序上
const probeBoth = async (p) => {
  const all = await probePort(p);
  return all === 'free' ? probePort(p, '127.0.0.1') : all;
};

export async function suggestPort(port, { probe = probeBoth } = {}) {
  const p = Number(port);
  const list = p < 1024 ? [3001, 8080, 3002, 3003, 8081] : Array.from({ length: 10 }, (_, i) => p + 1 + i);
  for (const c of list) {
    if (c === p || c < 1 || c > 65535) continue;
    if ((await probe(c)) === 'free') return c;
  }
  return null;
}

export function browserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { cmd: 'open', args: [url], opts: {} };
  // start 的第一个带引号参数是窗口标题，必须给空串；原样传参避免 Node 给 "" 再加转义
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', url], opts: { windowsVerbatimArguments: true } };
  return { cmd: 'xdg-open', args: [url], opts: {} };
}

export function openBrowser(url, { platform = process.platform, spawnFn = spawn } = {}) {
  const { cmd, args, opts } = browserCommand(url, platform);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(cmd, args, { stdio: 'ignore', windowsHide: true, ...opts });
    } catch {
      resolve(false);
      return;
    }
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
    child.unref?.();
  });
}
