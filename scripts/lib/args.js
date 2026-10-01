import net from 'node:net';
import path from 'node:path';
// 脚本公共参数（规格 §10）：--students N、--lesson <path>（设 LESSON_CONFIG）、--keep-db、--port；位置参数 N 等同 --students
const PORT_MIN = 3100;
const PORT_MAX = 3999;

function toInt(raw, flag, min, max) {
  const n = Number(raw);
  if (!/^\d+$/.test(String(raw)) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`参数 ${flag} 非法：${raw}`);
  }
  return n;
}

// 工作台在 3900–3909 里找空闲端口（scripts/manage/index.js）：simulate / load 的随机端口避开这一段（P4）
const MANAGE_MIN = 3900;
const MANAGE_MAX = 3909;
const SKIP = MANAGE_MAX - MANAGE_MIN + 1;

export function randomPort(random = Math.random) {
  const count = PORT_MAX - PORT_MIN + 1 - SKIP;
  const port = PORT_MIN + Math.min(count - 1, Math.floor(random() * count));
  return port >= MANAGE_MIN ? port + SKIP : port;
}

// S6：随机端口还要避开 3001（本机常驻服务）与工作台段，并先探测空闲（--port 显式给的照用，不探测）
const USER_PORT = 3001;
export function isExcludedPort(port) {
  return port === USER_PORT || (port >= MANAGE_MIN && port <= MANAGE_MAX);
}

// 与 scripts/manage/net.js probePort 同一规则（exclusive 监听所有地址）：'free' | 'in-use' | 'no-permission' | 'error'
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

/**
 * pickFreePort({ probe?, random?, tries? }) → 3100–3999 里去掉排除段、探测为空闲的随机端口；
 * 同一端口只探测一次（重复的跳过、不计 tries）；探测 tries 个不同端口都不空闲，或连续 tries 次抽到已试过的端口 → 抛错
 */
export async function pickFreePort({ probe = probePort, random = Math.random, tries = 50 } = {}) {
  const tried = new Set();
  let repeats = 0;
  while (tried.size < tries && repeats < tries) {
    const port = randomPort(random);
    if (isExcludedPort(port) || tried.has(port)) {
      repeats += 1;
      continue;
    }
    repeats = 0;
    tried.add(port);
    if ((await probe(port)) === 'free') return port;
  }
  throw new Error(`在 ${PORT_MIN}–${PORT_MAX} 里没找到空闲端口，请用 --port 指定`);
}

/** resolvePort(opts, { probe? }) → opts.portGiven 时照用 opts.port，否则 pickFreePort */
export async function resolvePort(opts, { probe } = {}) {
  if (opts.portGiven) return opts.port;
  return pickFreePort(probe ? { probe } : {});
}

/**
 * parseArgs(argv, { defaultStudents }) → { students, lesson, keepDb, port, portGiven }
 * 没给 --port 时 port 先取 randomPort()（不探测），调用方再用 resolvePort 换成探测为空闲的端口
 * 非法参数抛错；--lesson 同时写入 process.env.LESSON_CONFIG
 */
export function parseArgs(argv, { defaultStudents = 30 } = {}) {
  const out = { students: defaultStudents, lesson: null, keepDb: false, port: null, portGiven: false };
  const args = [...argv];
  while (args.length) {
    let a = args.shift();
    let inline;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const value = () => {
      const v = inline ?? args.shift();
      if (v === undefined || v === '') throw new Error(`参数 ${a} 缺少值`);
      return v;
    };
    if (a === '--students') out.students = toInt(value(), '--students', 1, 10000);
    else if (a === '--lesson') out.lesson = value();
    else if (a === '--keep-db') out.keepDb = true;
    else if (a === '--port') {
      out.port = toInt(value(), '--port', 1, 65535);
      out.portGiven = true;
    }
    else if (/^\d+$/.test(a)) out.students = toInt(a, '--students', 1, 10000);
    else throw new Error(`未知参数：${a}`);
  }
  if (out.port === null) out.port = randomPort();
  // 写入绝对路径：spawnServer 以 template 根为 cwd 启动服务，相对路径会让脚本与服务加载到不同的课
  if (out.lesson !== null) process.env.LESSON_CONFIG = path.resolve(out.lesson);
  return out;
}
