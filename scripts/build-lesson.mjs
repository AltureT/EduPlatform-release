#!/usr/bin/env node
// npm run build:lesson -- [lesson.config 路径]（K3 收尾）：把一门课的前端打包到系统临时目录，只为确认"学生页能打开"，
//   不碰平台自己的 dist/（管理台用的那份）。缺省课程取 .env 的 LESSON_CONFIG，再缺省 ./lesson.config.js。
//   退出码：0 打包成功（末行"通过：页面能打包"）；1 打包失败（原样打印 vite 的报错，末行"打包失败"）；2 参数错误。
//   buildLesson({ root, lesson, outDir?, command? }) → Promise<{ ok, code, outDir }>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readEnv } from './manage/env-file.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

export function resolveLessonArg(root, arg) {
  if (arg) return path.resolve(root, arg);
  let fromEnv = null;
  try {
    fromEnv = readEnv(root)?.LESSON_CONFIG || null;
  } catch {
    fromEnv = null;
  }
  return path.resolve(root, fromEnv || './lesson.config.js');
}

export function buildLesson({ root = projectRoot, lesson, outDir, command } = {}) {
  const lessonAbs = resolveLessonArg(root, lesson);
  if (!fs.existsSync(lessonAbs)) return Promise.resolve({ ok: false, code: 2, outDir: null, error: `找不到课程配置：${lessonAbs}` });
  const out = outDir ?? path.join(os.tmpdir(), 'edu-build-check');
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const cmd = command ?? [process.execPath, vite, 'build', '--outDir', out, '--emptyOutDir'];
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: root,
      env: { ...process.env, LESSON_CONFIG: path.relative(root, lessonAbs) },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', (err) => resolve({ ok: false, code: 1, outDir: out, error: err.message }));
    child.once('close', (code) => resolve({ ok: code === 0 && fs.existsSync(path.join(out, 'index.html')), code: code ?? 1, outDir: out }));
  });
}

async function main() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const r = await buildLesson({ lesson: arg });
  if (r.error) console.error(r.error);
  if (r.ok) {
    console.log('通过：页面能打包');
    process.exit(0);
  }
  console.error('打包失败：按上面的报错改（文件:行），改完再跑一次');
  process.exit(r.code === 2 ? 2 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
