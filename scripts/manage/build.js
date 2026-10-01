// 需要时构建（管理台规格 §4.3）
//   needsBuild(root, lessonConfig)：dist/index.html 或 dist/.built-for.json 缺失，或记录的课程与当前 LESSON_CONFIG 不同
//   sourceStale(root)：M3，源文件比上次构建新（首页"课程文件有更新"黄条；记录读不出 → false）
//   build(root, lessonConfig, onLine, { command?, onSpawn? }) → Promise<{ ok, code, lines }>
//     默认 spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build'])，env 带 LESSON_CONFIG；成功后写 .built-for.json
//   pipeLines(stream, onLine)：子进程输出按行回调（build 与平台进程共用）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KEEP_LINES = 200;
const recordFile = (root) => path.join(root, 'dist', '.built-for.json');

// 参与前端打包的源码位置：任一文件比上次构建新（例如 git pull 之后）就需要重建
const SOURCE_DIRS = ['kernel/client', 'components', 'examples', 'lessons'];
const SOURCE_FILES = ['index.html', 'vite.config.js', 'package.json', 'lesson.config.js'];
const SKIP_DIR = new Set(['__tests__', 'node_modules', 'data', 'vendor', 'dist']);
const DRAFT_PREFIX = '教学设计原稿';

export function newestSourceMtime(root) {
  let newest = 0;
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.name.startsWith(DRAFT_PREFIX)) continue; // M4：教案页（第 2 步）上传的教学设计原稿不参与打包
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) visit(full);
      } else {
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          // ignore
        }
      }
    }
  };
  for (const d of SOURCE_DIRS) visit(path.join(root, d));
  for (const f of SOURCE_FILES) {
    try {
      const m = fs.statSync(path.join(root, f)).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      // ignore
    }
  }
  return newest;
}

export function needsBuild(root, lessonConfig) {
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) return true;
  try {
    const rec = JSON.parse(fs.readFileSync(recordFile(root), 'utf8'));
    if (rec?.lessonConfig !== lessonConfig) return true;
    const builtAt = Date.parse(rec?.at);
    if (!Number.isFinite(builtAt)) return true;
    return newestSourceMtime(root) > builtAt;
  } catch {
    return true;
  }
}

// M3："课程有改动"提示：源文件比上次准备页面（.built-for.json 的 at）新；记录缺失或读不出时无法判断，返回 false
export function sourceStale(root) {
  let builtAt;
  try {
    builtAt = Date.parse(JSON.parse(fs.readFileSync(recordFile(root), 'utf8'))?.at);
  } catch {
    return false;
  }
  if (!Number.isFinite(builtAt)) return false;
  return newestSourceMtime(root) > builtAt;
}

export function pipeLines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const p of parts) onLine(p);
  });
  stream.on('end', () => {
    if (buf) onLine(buf);
    buf = '';
  });
}

export function build(root, lessonConfig, onLine = () => {}, { command, onSpawn } = {}) {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const cmd = command ?? [process.execPath, vite, 'build'];
  try {
    fs.rmSync(recordFile(root), { force: true });
  } catch {
    // ignore
  }
  if (!command && !fs.existsSync(vite)) {
    const lines = ['找不到构建工具（node_modules/vite），请关闭本窗口后重新双击启动入口完成安装'];
    lines.forEach(onLine);
    return Promise.resolve({ ok: false, code: null, lines });
  }
  return new Promise((resolve) => {
    const lines = [];
    const push = (l) => {
      lines.push(l);
      if (lines.length > KEEP_LINES) lines.shift();
      onLine(l);
    };
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: root,
      env: { ...process.env, LESSON_CONFIG: lessonConfig },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    onSpawn?.(child);
    pipeLines(child.stdout, push);
    pipeLines(child.stderr, push);
    child.once('error', (err) => {
      push(`构建进程无法启动：${err.message}`);
    });
    child.once('close', (code) => {
      const ok = code === 0 && fs.existsSync(path.join(root, 'dist', 'index.html'));
      if (ok) {
        fs.writeFileSync(recordFile(root), `${JSON.stringify({ lessonConfig, at: new Date().toISOString() })}\n`);
      }
      resolve({ ok, code, lines });
    });
  });
}
