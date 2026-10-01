// 环境自动准备（G4 工作台课程与平台两区重构规格 §3.1–§3.3）
//   "环境" = 课程（经组件的 requires）声明需要、平台文件夹里要有的运行时文件；按"种类"管，现在只有 pyodide（vendor/pyodide/）
//   ENV_KINDS[kind] = { dir, label }；kindOfPath(requires 路径) → kind | null（不认识的路径不管）
//   needsLessons(root) → 要算的课：lessons/*/lesson.config.js（读不读得出都列）+ .env 当前课（示例课 / 根目录课时）
//   computeNeeds(root, lessons) → { kinds: { pyodide: { neededBy: [课程配置路径], missing, paths } }, unknown: [读不出的课] }
//     逐课 checkRequires（process.js），按课程配置文件 mtime 缓存要求的路径；缺不缺每次按文件现查
//   failReason(lines, { spawnError, incomplete }) → 下载失败的一句话原因
//   createEnvPreparer({ root, fetchCommand?, log?, now?, retryAfterMs?, lessons?, env?, blocked?, diagnose? })
//     → { status(), trigger(), retry(), busy(), stop(), on(event, fn), off(event, fn) }
//     status() → { pyodide: { kind, state, percent, label, error, diagnosis, neededBy, result, nextRetryAt } }
//       state：'unneeded'（没有课需要）| 'ready' | 'preparing'（正在下载）| 'failed'（需要、缺、没在下载：上次失败或被 blocked 挡住）
//       percent / label：preparing 时按 ui-logic.js fetchProgress 解析下载输出；其它 null
//       error：failed 时的一句话原因；diagnosis：失败写成的排障文件 { file, at } | null（diagnose 回调给）
//       result：最近一次下载结束 { ok, at, code } | null；nextRetryAt：failed 且有失败时刻时，自动重试最早的时刻
//     trigger()：重算需求；需要且缺、没在下载、不被 blocked、距上次失败 ≥ retryAfterMs（缺省 10 分钟）→ 开始下载；→ Promise<status>
//     retry()：同 trigger，但不受节流（教师点"重试"）→ Promise<{ started, status }>
//     同一时间只跑一个下载（所有种类共用）；事件 'change'（status 对象）：开始、进度变化、结束、需求变化时发
//     stop(kind?)：结束自己起的下载子进程（只按子进程句柄，不按模式；给 kind 只停那一种）→ Promise（子进程都退出后）
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { checkRequires } from './process.js';
import { effectiveEnv, downloadEnv } from './env-file.js';
import { pipeLines } from './build.js';
import { fetchProgress } from './ui-logic.js';

export const RETRY_AFTER_MS = 10 * 60_000;
export const ENV_KINDS = {
  pyodide: { dir: 'vendor/pyodide', label: 'Python 环境' },
};
const KIND_NAMES = Object.keys(ENV_KINDS);
const MAX_LINES = 200;

const norm = (p) => path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
export function kindOfPath(p) {
  const n = norm(p);
  return KIND_NAMES.find((k) => n.startsWith(`${ENV_KINDS[k].dir}/`)) ?? null;
}

export async function needsLessons(root) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(path.join(root, 'lessons'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    // 没有 lessons/
  }
  for (const name of names) {
    if (fs.existsSync(path.join(root, 'lessons', name, 'lesson.config.js'))) out.push(`./lessons/${name}/lesson.config.js`);
  }
  const current = effectiveEnv(root).LESSON_CONFIG;
  if (current && !out.some((p) => norm(p) === norm(current)) && fs.existsSync(path.resolve(root, current))) out.push(current);
  return out;
}

// 课程配置绝对路径 → { mtimeMs, paths: [{ kind, path }] }
const cache = new Map();
export async function computeNeeds(root, lessons) {
  const kinds = Object.fromEntries(KIND_NAMES.map((k) => [k, { neededBy: [], missing: false, paths: [] }]));
  const unknown = [];
  for (const rel of lessons) {
    const abs = path.resolve(root, rel);
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch {
      continue; // 课已经不在了
    }
    let hit = cache.get(abs);
    if (!hit || hit.mtimeMs !== mtimeMs) {
      try {
        const r = await checkRequires(root, rel);
        const paths = [];
        for (const c of r.components) {
          for (const q of c.requires ?? []) {
            const kind = kindOfPath(q.path);
            if (kind) paths.push({ kind, path: norm(q.path) });
          }
        }
        hit = { mtimeMs, paths };
        cache.set(abs, hit);
      } catch {
        cache.delete(abs);
        unknown.push(rel);
        continue;
      }
    }
    for (const { kind, path: p } of hit.paths) {
      const k = kinds[kind];
      if (!k.neededBy.includes(rel)) k.neededBy.push(rel);
      if (!k.paths.includes(p)) k.paths.push(p);
    }
  }
  for (const k of Object.values(kinds)) k.missing = k.paths.some((p) => !fs.existsSync(path.join(root, ...p.split('/'))));
  return { kinds, unknown };
}

export function failReason(lines = [], { spawnError = false, incomplete = false } = {}) {
  if (spawnError) return '下载程序没能启动';
  if (incomplete) return '下载结束了，但文件不全';
  const text = lines.join('\n');
  if (/ENOSPC|no space left|磁盘空间不够/i.test(text)) return '磁盘空间不够';
  if (/ETIMEDOUT|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket hang up|timeout|超时|连不上/i.test(text)) return '网络连不上下载源';
  return '下载没有完成';
}

export function createEnvPreparer({
  root,
  fetchCommand,
  log = (m) => console.log(m),
  now = Date.now,
  retryAfterMs = RETRY_AFTER_MS,
  lessons = () => needsLessons(root),
  env = () => downloadEnv(root),
  blocked = () => null,
  diagnose = () => null,
}) {
  const ee = new EventEmitter();
  const commands = { pyodide: fetchCommand ?? [process.execPath, path.join(root, 'scripts', 'fetch-pyodide.mjs')] };
  const ks = Object.fromEntries(KIND_NAMES.map((k) => [k, {
    child: null, lines: [], lastFailAt: null, error: null, diagnosis: null, result: null, stopped: false, progress: null, closed: null,
  }]));
  let needs = { kinds: Object.fromEntries(KIND_NAMES.map((k) => [k, { neededBy: [], missing: false, paths: [] }])), unknown: [] };
  let blockedReason = null;

  const missingNow = (kind) => needs.kinds[kind].paths.some((p) => !fs.existsSync(path.join(root, ...p.split('/'))));
  function kindStatus(kind) {
    const k = ks[kind];
    const n = needs.kinds[kind];
    let state;
    if (k.child) state = 'preparing';
    else if (!n.neededBy.length) state = 'unneeded';
    else if (!missingNow(kind)) state = 'ready';
    else state = 'failed';
    const p = state === 'preparing' ? (k.progress ?? fetchProgress(k.lines)) : null;
    const failed = state === 'failed';
    return {
      kind,
      state,
      percent: p ? p.percent : null,
      label: p ? p.label : null,
      error: failed ? (k.error ?? (blockedReason ? `${blockedReason}，更新完会自动准备` : null)) : null,
      diagnosis: failed ? k.diagnosis : null,
      neededBy: [...n.neededBy],
      result: k.result,
      nextRetryAt: failed && k.lastFailAt !== null ? k.lastFailAt + retryAfterMs : null,
    };
  }
  const status = () => Object.fromEntries(KIND_NAMES.map((k) => [k, kindStatus(k)]));
  const emit = () => ee.emit('change', status());
  const busy = () => KIND_NAMES.some((k) => ks[k].child);

  function start(kind) {
    const k = ks[kind];
    const cmd = commands[kind];
    Object.assign(k, { lines: [], error: null, diagnosis: null, stopped: false, progress: null });
    let child;
    let finished = false;
    let closedResolve;
    k.closed = new Promise((r) => { closedResolve = r; });
    const finish = (code, spawnError) => {
      if (finished) return;
      finished = true;
      k.child = null;
      closedResolve();
      if (k.stopped) {
        emit();
        return;
      }
      const incomplete = !spawnError && code === 0 && missingNow(kind);
      const ok = !spawnError && code === 0 && !incomplete;
      k.result = { ok, at: now(), code: spawnError ? null : code };
      if (ok) {
        Object.assign(k, { lastFailAt: null, error: null, diagnosis: null });
        log(`[manage] ${ENV_KINDS[kind].label}已准备好`);
      } else {
        const reason = failReason(k.lines, { spawnError, incomplete });
        k.lastFailAt = now();
        k.error = reason;
        log(`[manage] ${ENV_KINDS[kind].label}没准备好：${reason}`);
        try {
          k.diagnosis = diagnose({ kind, reason, code, lines: [...k.lines] }) ?? null;
        } catch (err) {
          log(`[manage] 排障文件没能写：${err?.message ?? err}`);
          k.diagnosis = null;
        }
      }
      emit();
    };
    try {
      child = spawn(cmd[0], cmd.slice(1), { cwd: root, env: env(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      k.lines.push(`下载程序无法启动：${err.message}`);
      k.child = { kill() {} };
      finish(null, true);
      return;
    }
    k.child = child;
    const onLine = (line) => {
      k.lines.push(line);
      if (k.lines.length > MAX_LINES) k.lines.shift();
      const p = fetchProgress(k.lines);
      if (!k.progress || p.percent !== k.progress.percent || p.label !== k.progress.label) {
        k.progress = p;
        emit();
      }
    };
    pipeLines(child.stdout, onLine);
    pipeLines(child.stderr, onLine);
    child.once('error', (err) => {
      k.lines.push(`下载程序无法启动：${err.message}`);
      finish(null, true);
    });
    child.once('close', (code) => finish(code, false));
    log(`[manage] 开始准备${ENV_KINDS[kind].label}`);
    emit();
  }

  async function refresh() {
    try {
      needs = await computeNeeds(root, await lessons());
    } catch (err) {
      log(`[manage] 算课程需要的环境时出错：${err?.message ?? err}`);
    }
  }

  // 返回开始了下载的种类（最多一个）
  function maybeStart({ force }) {
    blockedReason = blocked() || null;
    if (busy() || blockedReason) return null;
    for (const kind of KIND_NAMES) {
      const k = ks[kind];
      if (!needs.kinds[kind].neededBy.length || !missingNow(kind)) continue;
      if (!force && k.lastFailAt !== null && now() - k.lastFailAt < retryAfterMs) continue;
      start(kind);
      return kind;
    }
    return null;
  }

  let last = JSON.stringify(status());
  async function trigger() {
    await refresh();
    if (!maybeStart({ force: false })) {
      const s = JSON.stringify(status());
      if (s !== last) emit();
    }
    last = JSON.stringify(status());
    return status();
  }
  async function retry() {
    await refresh();
    const started = Boolean(maybeStart({ force: true }));
    if (!started) emit();
    last = JSON.stringify(status());
    return { started, status: status() };
  }
  function stop(kind) {
    const waits = [];
    for (const [name, k] of Object.entries(ks)) {
      if (!k.child || (kind && name !== kind)) continue;
      k.stopped = true;
      waits.push(k.closed);
      try {
        k.child.kill();
      } catch {
        // 已经结束
      }
    }
    return Promise.all(waits).then(() => undefined);
  }

  return {
    status, trigger, retry, busy, stop,
    on: (ev, fn) => ee.on(ev, fn),
    off: (ev, fn) => ee.off(ev, fn),
  };
}
