// 脚本共用的会话辅助：临时 DB、超时、清理、CLI 入口
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function tempDbPath(tag) {
  return path.join(os.tmpdir(), `classroom-${tag}-${process.pid}-${randomUUID()}.sqlite`);
}

export function removeDbFiles(dbPath) {
  for (const ext of ['', '-shm', '-wal']) rmSync(dbPath + ext, { force: true });
}

export function randomPassword() {
  return randomUUID();
}

export function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时（${ms} ms）`)), ms);
    }),
  ]);
}

export function errMsg(err) {
  return err?.message ?? String(err);
}

/** 断开一组 { socket } 句柄（忽略空值） */
export function disconnectAll(handles) {
  for (const h of handles) h?.socket?.disconnect();
}

/**
 * 等待管理事件回执（规格 §5.3）：teacher:admin-ok { action } resolve；teacher:admin-error { action, message } reject；超时 reject。
 * 须在发出管理事件之前调用，以免错过回执。
 */
export function waitAdminAck(socket, action, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待 teacher:admin-ok { action:'${action}' } 超时（${timeout} ms）`));
    }, timeout);
    const onOk = (p) => {
      if (p?.action !== action) return;
      cleanup();
      resolve(p);
    };
    const onError = (p) => {
      if (p?.action !== action) return;
      cleanup();
      reject(new Error(`teacher:admin-error（${action}）：${p?.message ?? ''}`));
    };
    function cleanup() {
      clearTimeout(timer);
      socket.off('teacher:admin-ok', onOk);
      socket.off('teacher:admin-error', onError);
    }
    socket.on('teacher:admin-ok', onOk);
    socket.on('teacher:admin-error', onError);
  });
}

/** 作为 CLI 直接运行时执行 main(argv) 并以其返回值退出 */
export function runIfMain(importMetaUrl, main) {
  if (!process.argv[1] || importMetaUrl !== pathToFileURL(path.resolve(process.argv[1])).href) return;
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
