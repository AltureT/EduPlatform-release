// S18 原生依赖架构不符自动重装规格 §1：平台依赖里带原生绑定、按平台分包的两个，能不能在这台电脑上用
//   better-sqlite3：new Database(':memory:') 后关掉（绑定在第一次新建数据库时才加载）
//   rolldown：import('rolldown')（Vite 8 的打包器，按平台分包）
// 只认"装错了平台 / 坏了"的错误（node_modules 从别的电脑拷来、Parallels 共享文件夹等）；别的错误不算
//   （例如模块缺失 → 入口脚本本来就会装）。错误的 cause 链也看（rolldown 把每个平台包的加载错误挂在 cause 上）。
// checkNativeModules(root, { loaders }) → { ok, failed: [{ name, message }] }；loaders 供测试注入
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const NATIVE_MODULES = ['better-sqlite3', 'rolldown'];

const MISMATCH = [
  /not a valid Win32 application/i,
  /wrong ELF class/i,
  /incompatible architecture/i,
  /Module did not self-register/i,
  /Cannot find module '@rolldown\/binding-/,
  /Cannot find native binding/i,
];

export function isNativeMismatch(err) {
  for (let e = err, depth = 0; e && depth < 8; e = e.cause, depth++) {
    if (typeof e !== 'object') return false;
    if (e.code === 'ERR_DLOPEN_FAILED') return true;
    const msg = String(e.message ?? '');
    if (MISMATCH.some((re) => re.test(msg))) return true;
  }
  return false;
}

function defaultLoaders(root) {
  const req = createRequire(path.join(root, 'package.json'));
  return {
    'better-sqlite3': () => {
      const Database = req('better-sqlite3');
      new Database(':memory:').close();
    },
    rolldown: async () => {
      await import(pathToFileURL(req.resolve('rolldown')).href);
    },
  };
}

export async function checkNativeModules(root, { loaders } = {}) {
  const tries = loaders ?? defaultLoaders(root);
  const failed = [];
  for (const name of NATIVE_MODULES) {
    const load = tries[name];
    if (!load) continue;
    try {
      await load();
    } catch (err) {
      if (isNativeMismatch(err)) failed.push({ name, message: String(err?.message ?? err) });
    }
  }
  return { ok: failed.length === 0, failed };
}
