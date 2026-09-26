// 名单（管理台规格 §4.4）：平台运行中（调用方传 port）走平台的本机管理端点；未运行（传 dbPath）直接用 openDb 读写
//   preview(text) → { names, count }（解析规则只在 kernel/server/roster.js）
//   importNames({ names, port | dbPath }) → { count }
//   clear(...) / resetBindings(...)
//   status({ port | dbPath }) → { names, count, bound }
//   countStudents({ dbPath, online }) → 学生记录数（首页数据磁贴）
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { parseRoster, normalizeNames } from '../../kernel/server/roster.js';
import { openDb } from '../../kernel/server/db.js';

const userError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

export function preview(text) {
  const names = parseRoster(text);
  return { names, count: names.length };
}

async function callPlatform(port, method, urlPath, body) {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw userError(`平台没有响应：${err?.message ?? err}`, 502);
  }
  if (!res.ok) throw userError(`平台拒绝了请求（${res.status}）`, 502);
  return res.json().catch(() => ({}));
}

function withDb(dbPath, fn) {
  const db = openDb(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export async function importNames({ names, port, dbPath }) {
  const list = normalizeNames(Array.isArray(names) ? names : []);
  if (list.length === 0) throw userError('名单为空，请检查是否每行一个名字');
  if (port) {
    const r = await callPlatform(port, 'POST', '/api/admin/roster', { names: list });
    return { count: r.count ?? list.length };
  }
  return { count: withDb(dbPath, (db) => db.replaceRoster(list)) };
}

export async function clear({ port, dbPath }) {
  if (port) await callPlatform(port, 'POST', '/api/admin/roster/clear', {});
  else if (fs.existsSync(dbPath)) withDb(dbPath, (db) => db.clearRoster());
}

export async function resetBindings({ port, dbPath }) {
  if (port) await callPlatform(port, 'POST', '/api/admin/device-bindings/clear', {});
  else if (fs.existsSync(dbPath)) withDb(dbPath, (db) => db.clearDeviceBindings());
}

export async function status({ port, dbPath }) {
  if (port) {
    const r = await callPlatform(port, 'GET', '/api/roster');
    const names = Array.isArray(r.rosterNames) ? r.rosterNames : [];
    return { names, count: names.length, bound: Array.isArray(r.claimedNames) ? r.claimedNames.length : 0 };
  }
  if (!fs.existsSync(dbPath)) return { names: [], count: 0, bound: 0 };
  return withDb(dbPath, (db) => {
    const names = db.loadRoster().map((r) => r.name);
    return { names, count: names.length, bound: db.loadDeviceBindings().length };
  });
}

// 运行中只读打开（平台已建好 -shm，WAL 允许并发读）；未运行走 openDb（关闭时清理 -wal / -shm）
export function countStudents({ dbPath, online = false }) {
  if (!fs.existsSync(dbPath)) return 0;
  if (!online) return withDb(dbPath, (db) => db.loadStudents().length);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM students').get().n;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}
