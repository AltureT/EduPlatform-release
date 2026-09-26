// 冻结接口（规格 §10）：spawnServer({ port, dbPath, env }) → Promise<{ base, stop() }>
// 自动设临时 AUTH_TOKEN_FILE；轮询 GET /api/roster 就绪（200），10 s 超时 reject 并附 stderr 尾部
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const READY_TIMEOUT = 10000;
const POLL_INTERVAL = 100;
const KILL_GRACE = 2000;
const STDERR_TAIL = 4000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function spawnServer({ port, dbPath, env = {} } = {}) {
  const base = `http://127.0.0.1:${port}`;
  const authTokenFile = path.join(os.tmpdir(), `kernel-auth-${process.pid}-${randomUUID()}.json`);
  const childEnv = { ...process.env, AUTH_TOKEN_FILE: authTokenFile, ...env, PORT: String(port) };
  if (dbPath !== undefined) childEnv.DB_PATH = dbPath;

  const child = spawn('node', ['kernel/server/index.js'], {
    cwd: TEMPLATE_ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (d) => {
    stderr = (stderr + d.toString()).slice(-STDERR_TAIL);
  });
  let exited = null;
  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      exited = { code, signal };
      resolve();
    });
  });

  async function stop() {
    if (!exited) {
      child.kill('SIGTERM');
      const t = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, KILL_GRACE);
      await exitPromise;
      clearTimeout(t);
    }
    rmSync(authTokenFile, { force: true });
  }

  const deadline = Date.now() + READY_TIMEOUT;
  while (Date.now() < deadline) {
    if (exited) {
      await stop();
      throw new Error(`spawnServer: server exited early (code=${exited.code}, signal=${exited.signal})\n--- stderr tail ---\n${stderr}`);
    }
    try {
      const res = await fetch(`${base}/api/roster`);
      await res.arrayBuffer();
      if (res.status === 200) return { base, stop };
    } catch {
      // 尚未监听，继续轮询
    }
    await sleep(POLL_INTERVAL);
  }
  await stop();
  throw new Error(`spawnServer: not ready within ${READY_TIMEOUT}ms (GET ${base}/api/roster)\n--- stderr tail ---\n${stderr}`);
}
