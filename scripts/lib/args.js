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

// 管理台在 3900–3909 里找空闲端口（scripts/manage/index.js）：simulate / load 的随机端口避开这一段（P4）
const MANAGE_MIN = 3900;
const MANAGE_MAX = 3909;
const SKIP = MANAGE_MAX - MANAGE_MIN + 1;

export function randomPort(random = Math.random) {
  const count = PORT_MAX - PORT_MIN + 1 - SKIP;
  const port = PORT_MIN + Math.min(count - 1, Math.floor(random() * count));
  return port >= MANAGE_MIN ? port + SKIP : port;
}

/**
 * parseArgs(argv, { defaultStudents }) → { students, lesson, keepDb, port }
 * 非法参数抛错；--lesson 同时写入 process.env.LESSON_CONFIG
 */
export function parseArgs(argv, { defaultStudents = 30 } = {}) {
  const out = { students: defaultStudents, lesson: null, keepDb: false, port: null };
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
    else if (a === '--port') out.port = toInt(value(), '--port', 1, 65535);
    else if (/^\d+$/.test(a)) out.students = toInt(a, '--students', 1, 10000);
    else throw new Error(`未知参数：${a}`);
  }
  if (out.port === null) out.port = randomPort();
  // 写入绝对路径：spawnServer 以 template 根为 cwd 启动服务，相对路径会让脚本与服务加载到不同的课
  if (out.lesson !== null) process.env.LESSON_CONFIG = path.resolve(out.lesson);
  return out;
}
