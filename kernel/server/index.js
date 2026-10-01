// 服务端入口：读 .env → LESSON_CONFIG / DB_PATH / PORT（默认 80）→ createApp → listen；SIGTERM 时 stop() 并关库
// 名单与数据以课程为主体规格 §2.1：DB_PATH 显式设置时照旧（测试、spawnServer、开发用；等于旧缺省 data/classroom.sqlite 视为没设置）；
//   否则读课程 id → data/lessons/<id>.sqlite（相对当前目录，openDb 会建目录）
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { createLog } from './log.js';

dotenv.config({ quiet: true });

const log = createLog('server');

process.on('uncaughtException', (err) => log.error('uncaughtException', err?.stack ?? String(err)));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason?.stack ?? String(reason)));

// auth.js 在 import 时读取 AUTH_TOKEN_FILE，必须在 dotenv 之后加载
const { createApp } = await import('./app.js');

const lessonPath = process.env.LESSON_CONFIG || './lesson.config.js';
const port = Number(process.env.PORT || 80);
if (!process.env.TEACHER_PASSWORD) log.warn('TEACHER_PASSWORD 未设置，教师无法登录');

// 课程 id → 这门课的库；读不出 id 时由 loadLesson 报同一句中文错误
async function lessonDb() {
  const { lessonDbPath, isOldDefaultDbPath } = await import('./lesson-db-path.js');
  // .env 里还留着旧缺省 data/classroom.sqlite（升级前生成的）视为没设置
  if (process.env.DB_PATH && !isOldDefaultDbPath(process.env.DB_PATH)) return process.env.DB_PATH;
  const mod = await import(pathToFileURL(path.resolve(process.cwd(), lessonPath)).href);
  return lessonDbPath(process.cwd(), mod.default?.id);
}

let kernel;
try {
  const dbPath = await lessonDb();
  kernel = await createApp({ lessonPath, dbPath });
  await kernel.start(port);
} catch (err) {
  log.error('startup failed', err?.stack ?? String(err));
  try {
    kernel?.db.close();
  } catch {
    // ignore
  }
  process.exit(1);
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`${signal} received, shutting down`);
  try {
    await kernel.stop();
  } catch (err) {
    log.error('stop failed', err?.message ?? String(err));
  } finally {
    kernel.db.close();
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
