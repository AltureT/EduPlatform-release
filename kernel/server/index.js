// 服务端入口：读 .env → LESSON_CONFIG / DB_PATH / PORT（默认 80）→ createApp → listen；SIGTERM 时 stop() 并关库
import dotenv from 'dotenv';
import { createLog } from './log.js';

dotenv.config({ quiet: true });

const log = createLog('server');

process.on('uncaughtException', (err) => log.error('uncaughtException', err?.stack ?? String(err)));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason?.stack ?? String(reason)));

// auth.js 在 import 时读取 AUTH_TOKEN_FILE，必须在 dotenv 之后加载
const { createApp } = await import('./app.js');

const lessonPath = process.env.LESSON_CONFIG || './lesson.config.js';
const dbPath = process.env.DB_PATH || './data/classroom.sqlite';
const port = Number(process.env.PORT || 80);
if (!process.env.TEACHER_PASSWORD) log.warn('TEACHER_PASSWORD 未设置，教师无法登录');

let kernel;
try {
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
