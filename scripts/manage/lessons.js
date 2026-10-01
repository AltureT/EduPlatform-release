// 可选课程扫描（管理台规格 §2、§3 LESSON_CONFIG）
//   listLessons(root, { current }) → [{ path, id, title, example? }]：lessons/*/lesson.config.js
//     G3（管理台线性路径重设计规格 §2.4）：示例课 examples/ 不再列出；只有当前值 current 指着 examples/<x>（旧安装）时多出这一项
//     （example: true，path 用当前值原样），换走就没了
//     path 为相对项目根、以 ./ 开头、用 / 分隔的路径（即写进 .env 的 LESSON_CONFIG 值）；import 失败的目录跳过并 warn
//   readLesson(root, relPath) → { path, id, title, config } | null：按文件 mtime 重新 import，改动后能读到新值
//   listLessonChoices(root, { current }) → 课程下拉（M2）：listLessons 每项加 dir（相对目录，如 lessons/leap），
//     项目根的 lesson.config.js 是当前课时（G3）标 dev: true、dir: '' 并排在最后（"我的课程（自定义）"）
//   lessonDir(relPath) → 'examples/minimal'；根目录配置为 ''
//   lessonStatus(root, relPath)（M4 课程列表（第 1 步））：课程目录 进度.md → 当前环 / 下一步 / 阶段表做完段数，见文件末尾
export const DEV_LESSON = './lesson.config.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCAN_DIRS = ['lessons'];
const EXAMPLE_RE = /^examples\/([^/]+)\/lesson\.config\.js$/;

export async function readLesson(root, relPath) {
  const file = path.resolve(root, relPath);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  // 查询串带 mtime：文件未变时复用模块缓存，变了才重新求值
  const mod = await import(`${pathToFileURL(file).href}?mtime=${stat.mtimeMs}`);
  const config = mod.default ?? {};
  return { path: relPath, id: config.id ?? null, title: config.title ?? null, config };
}

export async function listLessons(root, { warn = (m) => console.warn(m), current = null } = {}) {
  const out = [];
  for (const dir of SCAN_DIRS) {
    const base = path.join(root, dir);
    let names;
    try {
      names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const rel = `./${dir}/${name}/lesson.config.js`;
      if (!fs.existsSync(path.join(base, name, 'lesson.config.js'))) continue;
      try {
        const l = await readLesson(root, rel);
        if (l) out.push({ path: l.path, id: l.id, title: l.title });
      } catch (err) {
        warn(`[manage] 跳过课程 ${dir}/${name}：${err?.message ?? err}`);
      }
    }
  }
  // G3：旧安装的当前课还指着示例课 → 只多这一项
  const ex = EXAMPLE_RE.exec(normPath(current));
  if (ex && fs.existsSync(path.join(root, 'examples', ex[1], 'lesson.config.js'))) {
    try {
      const l = await readLesson(root, current);
      if (l) out.push({ path: current, id: l.id, title: l.title, example: true });
    } catch (err) {
      warn(`[manage] 跳过课程 examples/${ex[1]}：${err?.message ?? err}`);
    }
  }
  return out;
}

const normPath = (p) => (p ? path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^(\.\/)+/, '') : '');

export function lessonDir(relPath) {
  const dir = path.posix.dirname(String(relPath).replace(/\\/g, '/')).replace(/^\.\//, '');
  return dir === '.' ? '' : dir;
}

export async function listLessonChoices(root, { warn = (m) => console.warn(m), current = null } = {}) {
  const out = (await listLessons(root, { warn, current })).map((l) => ({ ...l, dir: lessonDir(l.path) }));
  if (normPath(current) === 'lesson.config.js' && fs.existsSync(path.join(root, 'lesson.config.js'))) {
    try {
      const l = await readLesson(root, DEV_LESSON);
      if (l) out.push({ path: DEV_LESSON, id: l.id, title: l.title, dir: '', dev: true });
    } catch (err) {
      warn(`[manage] 跳过项目根的 lesson.config.js：${err?.message ?? err}`);
    }
  }
  return out;
}

// ===== M4：课程列表（第 1 步）的做课进度（lessons/<id>/进度.md，格式见 skills/参考/进度文件模板.md） =====
//   lessonStatus(root, relPath) → relPath 可以是课程目录（lessons/leap）或其 lesson.config.js 路径
//     没有 进度.md：examples/ 下 { kind: 'example' }，其它 { kind: 'none' }
//     读出："当前环：NN"、"下一步：…"、阶段表里做完的段数（骨架到审查五格都以 ✓ 开头）/ 总段数
//       → { kind: 'progress', ring, ringName, next, stagesDone, stagesTotal, stages }
//     stages（V1 代码题测试验证规格 §5，管理台只读备课表）：阶段表逐行 { label, dir, how, cells: [骨架, 内容, 检查, 模拟, 审查, 存档] 原文, done }
//     两行都找不到（格式不对）→ { kind: 'unknown' }
export const RING_NAMES = ['环境与项目', '教学设计', '平台规格', '脚手架与计划', '执行与审查', '磨课', '上课与课后'];

function progressDir(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  return p.endsWith('/lesson.config.js') ? lessonDir(p) : p.replace(/^\.\//, '').replace(/\/+$/, '');
}

export function parseProgress(text) {
  const lines = String(text).split(/\r?\n/);
  const ringLine = lines.map((l) => /^\s*[-*]?\s*当前环[：:]\s*(\d{1,2})/.exec(l)).find(Boolean);
  const nextLine = lines.map((l) => /^\s*下一步[：:]\s*(.+?)\s*$/.exec(l)).find(Boolean);
  if (!ringLine && !nextLine) return { kind: 'unknown' };
  const ring = ringLine ? Number(ringLine[1]) : null;
  // 阶段表：从"## 阶段表"到下一个"## "之间的表格行，跳过表头与分隔行
  let stagesDone = 0;
  let stagesTotal = 0;
  const stages = [];
  const start = lines.findIndex((l) => /^##\s*阶段表/.test(l));
  if (start >= 0) {
    let header = true;
    for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i += 1) {
      const l = lines[i].trim();
      if (!l.startsWith('|')) continue;
      const cells = l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (header) {
        header = false;
        continue;
      }
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // 分隔行
      stagesTotal += 1;
      const work = cells.slice(3, 8); // 骨架 内容 检查 模拟 审查
      const done = work.length === 5 && work.every((c) => c.startsWith('✓'));
      if (done) stagesDone += 1;
      const six = cells.slice(3, 9);
      while (six.length < 6) six.push('');
      stages.push({ label: cells[0] ?? '', dir: cells[1] ?? '', how: cells[2] ?? '', cells: six, done });
    }
  }
  return {
    kind: 'progress',
    ring,
    ringName: Number.isInteger(ring) ? RING_NAMES[ring] ?? null : null,
    next: nextLine ? nextLine[1] : null,
    stagesDone,
    stagesTotal,
    stages,
  };
}

export function lessonStatus(root, relPath) {
  const dir = progressDir(relPath);
  let text;
  try {
    text = fs.readFileSync(path.join(root, dir, '进度.md'), 'utf8');
  } catch {
    return { kind: dir.startsWith('examples/') ? 'example' : 'none' };
  }
  return parseProgress(text);
}
