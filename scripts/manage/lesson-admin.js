// 工作台"新建课程"与"全部课程"页（G5：左栏 #new / #courses；原 G3 第 1 步课程列表）的服务端逻辑（发布包与课程管理规格 §4，M4）：路由在 server.js
//   resolveLessonDir(root, scope, name, { mineOnly }) → { abs, rel, scope, name, kind, configRel }
//     安全：scope 只能是 lessons / examples；name 是一层目录名（不含分隔符、不以 . 开头）；解析后必须正好在 root/<scope> 下；
//     root/<scope> 的目录项里必须有与 name 完全相同的一项（审查 A1：不区分大小写的文件系统上 PYTHON-2 不能命中 python-2，
//     Windows 结尾的点 / 空格同理）；不能是链接；目录里要有 lesson.config.js。不合格 400、找不到 404；mineOnly 时示例课 403
//   sameLessonPath(a, b)：两个 LESSON_CONFIG 写法是否指同一门课（去 ./、反斜杠转 /、posix normalize 后比较）
//   findDraft(dir) / saveDraft(dir, { filename, data }) → 原稿固定存为 教学设计原稿.<ext>（ext 白名单 .md .txt .docx .pdf，
//     文件名不取用户输入）；已有的原稿（任何扩展名，含 docx 抽出的 .txt）先改名 <原名>.bak；.docx 抽纯文本另存 .txt
//     （docx-text.js：document.xml 解压后 > 30 MB 不抽；mammoth 在 worker 里跑，512 MB 内存上限、30 s 超时；失败 textError）
//   openingText({ title, rel, draft })：复制给 AI 的开场话（规格 §4 句式）
//   lessonOverview(root, { current, checks }) → 课程列表（第 1 步）列表行（只列 lessons/；读不出来的课也列出，broken: true）
//     G3（管理台线性路径重设计规格 §2.4）：示例课不列，只有当前课还指着 examples/<x>（旧安装）时多出那一行（kind: 'example'）
//     每行 check（V1 代码题测试验证规格 §5）：checks（检查结果数组，{ path, at, ok, errors, warnings, tests }）里同一门课最新的一条的摘要
//     { ok, errors: 条数, warnings: 条数, at, tests }；没查过 null
//     M6：每行 data = 这门课的库与备份摘要 { roster, dbBytes, lastBackup } | null（库还不存在、读不出来的课）
//   currentLessonRow(root, rel, { checks })（G3）：overview.currentLesson，见函数前注释
//   createLesson(root, { title, now }) → 生成 id（scripts/lib/lesson-id.js）并调用 newLesson（写 .env，成为当前课程）
//   deleteLesson(root, resolved, { now, dataId, current }) → 移到 backups/deleted-lessons/<目录名>-<YYYYMMDD_HHMMSS>/（不直接删）；
//     M6：dataId（这门课的 id，且没有别的课共用、没有自定义 DB_PATH 时由调用方给）→ 它的库与备份一并移到该目录的 data/
//     G4：current（.env 的 LESSON_CONFIG）指的就是这门课 → 删后当前课换成列表里下一门 / 清空，返回 current: { to }（见函数前注释）
//   renameLesson(root, resolved, { title })（G4）→ 只改 lesson.config.js 的 title 字面量；示例课 403，写法特殊 400
//     G4：async；移走后调 cleanupEnvironments，返回值多 cleaned（清掉的环境种类，如 ['pyodide']）
//   cleanupEnvironments(root, { beforeClean? }) → 清掉的种类数组（G4 工作台课程与平台两区重构规格 §3.3）：重算剩下的课需要哪些环境（env-prepare.js），
//     某种环境没有课再需要 → 删它在平台文件夹里的派生目录（Python：vendor/pyodide/ 整个目录）；vendor/ 下拷来的整包 zip、vendor/node 不动；
//     有课读不出来（不知道它要不要）→ 保守不删；G4 收尾：没有课再需要的种类先 await beforeClean(kind)（工作台用它停掉正在跑的下载，
//     免得下载完目录又出现），再删目录；deleteLesson 的 beforeClean 原样传进来
//   folderCommand / openFolder：Mac open、Windows explorer、其它 xdg-open
//   MESSAGES：给教师看的一句话（__tests__/lessons-copy.test.js 过禁词）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readLesson, lessonStatus } from './lessons.js';
import { pickLessonId } from '../lib/lesson-id.js';
import { newLesson } from '../new-lesson.mjs';
import { docxTextTooBig, docxToTextInWorker } from './docx-text.js';
import { moveLessonData, dataSummary, lessonPaths } from './backup.js';
import { customDbPath, writeEnv } from './env-file.js';
import { defaultObject, quoteJs } from '../lib/config-edit.js';
import { lessonIdError, lessonDbPath } from '../../kernel/server/lesson-db-path.js';
import { computeNeeds, needsLessons, ENV_KINDS } from './env-prepare.js';

export const DRAFT_BASE = '教学设计原稿';
export const DRAFT_EXTS = ['.md', '.txt', '.docx', '.pdf'];
export const MAX_DRAFT_BYTES = 20 * 1024 * 1024;
export const MAX_TITLE_LEN = 40;
const SCOPES = { lessons: 'mine', examples: 'example' };
const DELETED_DIR = 'backups/deleted-lessons';

export const MESSAGES = {
  badDir: '课程位置不对，请刷新页面后再试',
  notFound: '找不到这门课程，可能已经删掉了；请刷新页面',
  exampleNoUpload: '示例课不能上传教案；想照着它做一门，请先新建课程',
  exampleNoDelete: '示例课不能删除',
  exampleNoCurrent: '示例课只给 AI 照着做，不能设为当前课程；请先新建自己的课',
  exampleNoOpening: '示例课已经做好，可以直接上；想照着它做一门，请先新建课程',
  exampleNoRename: '示例课不能改名；想照着它做一门，请先新建课程',
  renameFailed: '这门课的课名写法特殊，没法在这里改；请让帮你做课的 AI 改',
  deleteRunning: '平台正在上这门课，请先停止平台再删除',
  deletePreparing: '平台正在准备，稍后再删',
  deleteFailed: '没能删除：这门课的文件夹可能正在别的窗口里打开，关掉后再试',
  badExt: '只能上传 Word（.docx）、PDF、Markdown（.md）或纯文本（.txt）文件',
  tooBig: '文件太大了，教案不能超过 20 MB',
  noFile: '没有收到文件，请重新选择后上传',
  uploadFailed: '上传没有完成，请再试一次',
  badTitle: `请填写课名（一行文字，不超过 ${MAX_TITLE_LEN} 个字）`,
  broken: '这门课程的文件有错，读不出来；请让帮你生成课程的 AI 检查后再试',
  openFailed: '没能打开文件夹，请在平台文件夹里手动找到它',
};

export const userError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

// ===== 目录白名单 =====
export function resolveLessonDir(root, scope, name, { mineOnly = false } = {}) {
  if (!Object.hasOwn(SCOPES, scope)) throw userError(MESSAGES.badDir, 400);
  if (typeof name !== 'string' || name === '' || name.startsWith('.') || /[/\\\0:]/.test(name)) {
    throw userError(MESSAGES.badDir, 400);
  }
  const base = path.resolve(root, scope);
  const abs = path.resolve(base, name);
  if (path.dirname(abs) !== base) throw userError(MESSAGES.badDir, 400);
  // 目录项里必须有完全相同的名字（大小写、结尾点 / 空格都不能差）
  let names;
  try {
    names = fs.readdirSync(base);
  } catch {
    throw userError(MESSAGES.notFound, 404);
  }
  if (!names.includes(name)) throw userError(MESSAGES.notFound, 404);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    throw userError(MESSAGES.notFound, 404);
  }
  if (st.isSymbolicLink()) throw userError(MESSAGES.badDir, 400);
  if (!st.isDirectory() || !fs.existsSync(path.join(abs, 'lesson.config.js'))) throw userError(MESSAGES.notFound, 404);
  const kind = SCOPES[scope];
  // mineOnly：true 或 403 时要说的话（上传 / 删除 / 开场话各有一句）
  if (mineOnly && kind !== 'mine') throw userError(typeof mineOnly === 'string' ? mineOnly : MESSAGES.exampleNoUpload, 403);
  const rel = `${scope}/${name}`;
  return { abs, rel, scope, name, kind, configRel: `./${rel}/lesson.config.js` };
}

// ===== 原稿 =====
const draftFile = (dir, ext) => path.join(dir, DRAFT_BASE + ext);

export function findDraft(dir) {
  const has = (ext) => fs.existsSync(draftFile(dir, ext));
  // 主文件：教师上传的那份（docx 旁边的 .txt 是抽出来的文本）
  for (const ext of ['.docx', '.pdf', '.md', '.txt']) {
    if (!has(ext)) continue;
    const hasText = ext === '.docx' ? has('.txt') : ext !== '.pdf';
    return { file: DRAFT_BASE + ext, ext, hasText };
  }
  return null;
}

export async function docxToText(buf) {
  if (docxTextTooBig(buf)) throw new Error('docx too big or not a zip');
  return docxToTextInWorker(buf);
}

export const normLessonPath = (p) => path.posix.normalize(String(p ?? '').replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
export const sameLessonPath = (a, b) => Boolean(a) && Boolean(b) && normLessonPath(a) === normLessonPath(b);

export async function saveDraft(dir, { filename, data }, { extractText = docxToText } = {}) {
  const ext = path.extname(String(filename ?? '')).toLowerCase();
  if (!DRAFT_EXTS.includes(ext)) throw userError(MESSAGES.badExt, 400);
  if (!Buffer.isBuffer(data)) throw userError(MESSAGES.noFile, 400);
  // 旧原稿（任何扩展名）改名 .bak：不留下和新原稿对不上的文本版
  for (const e of DRAFT_EXTS) {
    const f = draftFile(dir, e);
    if (fs.existsSync(f)) fs.renameSync(f, `${f}.bak`);
  }
  fs.writeFileSync(draftFile(dir, ext), data);
  let textError = false;
  if (ext === '.docx') {
    try {
      const text = await extractText(data);
      if (text.trim() === '') throw new Error('empty');
      fs.writeFileSync(draftFile(dir, '.txt'), text);
    } catch {
      textError = true;
    }
  }
  return { draft: findDraft(dir), textError };
}

// ===== 开场话 =====
export function openingText({ title, rel, draft }) {
  const dir = `${rel}/`;
  const head = `我要做《${title}》这节课。课程目录是 ${dir}，`;
  const middle = draft
    ? `教学设计原稿在 ${dir}${draft.file}${draft.ext === '.docx' && draft.hasText ? '（有 .txt 版）' : ''}。`
    : '教学设计我口述给你。';
  return `${head}${middle}请先读 skills/SKILL.md，按它做。`;
}

// ===== 列表 =====
function subdirs(root, scope) {
  try {
    return fs.readdirSync(path.join(root, scope), { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, scope, d.name, 'lesson.config.js')))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

// 某门课最近一次检查的摘要（checks 里路径写法不同也认）
export function checkSummaryFor(configRel, checks = []) {
  const c = (checks ?? []).filter((x) => x && typeof x.path === 'string' && sameLessonPath(x.path, configRel))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
  if (!c) return null;
  return { ok: Boolean(c.ok), errors: c.errors?.length ?? 0, warnings: c.warnings?.length ?? 0, at: c.at ?? null, tests: Array.isArray(c.tests) ? c.tests : [] };
}

export async function lessonRow(root, scope, name, { current, checks } = {}) {
  const rel = `${scope}/${name}`;
  const configRel = `./${rel}/lesson.config.js`;
  const base = {
    path: configRel,
    dir: rel,
    kind: SCOPES[scope],
    status: lessonStatus(root, rel),
    current: sameLessonPath(configRel, current),
    draft: scope === 'lessons' ? findDraft(path.join(root, scope, name)) : null,
    check: checkSummaryFor(configRel, checks),
  };
  try {
    const l = await readLesson(root, configRel);
    if (!l) throw new Error('missing');
    const stages = l.config?.stages;
    const data = lessonIdError(l.id) ? null : dataSummary(lessonPaths(root, l.id, { customDb: customDbPath(root) }));
    return { ...base, id: l.id, title: l.title, stages: Array.isArray(stages) ? stages.length : 0, data };
  } catch (err) {
    return { ...base, id: null, title: null, stages: 0, broken: true, error: String(err?.message ?? err), data: null };
  }
}

export async function lessonOverview(root, { current, checks, allExamples = false } = {}) {
  const rows = [];
  for (const name of subdirs(root, 'lessons')) rows.push(await lessonRow(root, 'lessons', name, { current, checks }));
  // G3：示例课不列；旧安装的当前课还指着 examples/<x> 时只多这一行（allExamples：服务端内部查同 id 共用库时全列）
  const ex = /^examples\/([^/]+)\/lesson\.config\.js$/.exec(current ? normLessonPath(current) : '');
  for (const name of subdirs(root, 'examples')) {
    if (allExamples || (ex && ex[1] === name)) rows.push(await lessonRow(root, 'examples', name, { current, checks }));
  }
  return rows;
}

// G3（管理台线性路径重设计规格 §3.1）：overview.currentLesson——当前课的一行（lessonRow 同形）
//   lessons/<x>、examples/<x>（遗留）→ lessonRow；根目录开发课（或别的路径）→ kind 'dev'、status none、draft null；
//   空值或找不到 → null；文件在但读不出来 → broken: true
export async function currentLessonRow(root, rel, { checks } = {}) {
  if (!rel) return null;
  const n = normLessonPath(rel);
  const m = /^(lessons|examples)\/([^/]+)\/lesson\.config\.js$/.exec(n);
  if (m) {
    if (!subdirs(root, m[1]).includes(m[2])) return null;
    return lessonRow(root, m[1], m[2], { current: rel, checks });
  }
  if (!fs.existsSync(path.resolve(root, n))) return null;
  const dir = path.posix.dirname(n);
  const base = {
    path: rel, dir: dir === '.' ? '' : dir, kind: 'dev', status: { kind: 'none' }, current: true, draft: null, check: checkSummaryFor(rel, checks),
  };
  try {
    const l = await readLesson(root, rel);
    if (!l) return null;
    const stages = l.config?.stages;
    const data = lessonIdError(l.id) ? null : dataSummary(lessonPaths(root, l.id, { customDb: customDbPath(root) }));
    return { ...base, id: l.id, title: l.title, stages: Array.isArray(stages) ? stages.length : 0, data };
  } catch (err) {
    return { ...base, id: null, title: null, stages: 0, broken: true, error: String(err?.message ?? err), data: null };
  }
}

// ===== 新建 =====
export function validTitle(title) {
  if (typeof title !== 'string') return null;
  const t = title.trim();
  if (t === '' || /[\r\n]/.test(t) || Array.from(t).length > MAX_TITLE_LEN) return null;
  return t;
}

export async function createLesson(root, { title, now = new Date() } = {}) {
  const t = validTitle(title);
  if (!t) throw userError(MESSAGES.badTitle, 400);
  const usedIds = new Set();
  for (const scope of Object.keys(SCOPES)) {
    for (const name of subdirs(root, scope)) {
      try {
        const l = await readLesson(root, `./${scope}/${name}/lesson.config.js`);
        if (l?.id) usedIds.add(String(l.id));
      } catch {
        // 读不出来的课不影响起名（目录名另行检查）
      }
    }
  }
  // M6 审查：已删课程留下的库（或未整理的同名库）也算占用，新课不会接手旧数据
  const hasDb = (id) => {
    try {
      return fs.existsSync(lessonDbPath(root, id));
    } catch {
      return false;
    }
  };
  const taken = (id) => usedIds.has(id) || Object.keys(SCOPES).some((s) => fs.existsSync(path.join(root, s, id))) || hasDb(id);
  const id = pickLessonId({ title: t, taken, now });
  const r = await newLesson({ root, id, title: t, dir: 'lessons', env: true });
  return { id, rel: `lessons/${id}`, configRel: r.configRel };
}

// ===== 删除（移到备份目录） =====
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// G4（工作台两区重构规格 §1）：删的是当前课（current 与这门课是同一门）→ 移走以后把 .env 的 LESSON_CONFIG 换成列表里下一门
//   （lessons/ 按目录名排序，删掉的后一门；它是最后一门则前一门；没有别的课则清空 = 还没有课程）；返回 current: { to } | null。
//   先移走再换：移动失败（409）时当前课不变
function nextLessonConfig(root, name) {
  const names = subdirs(root, 'lessons');
  const rest = names.filter((n) => n !== name);
  if (rest.length === 0) return '';
  const after = rest.find((n) => n > name) ?? rest.at(-1);
  return `./lessons/${after}/lesson.config.js`;
}

export async function deleteLesson(root, resolved, { now = new Date(), dataId = null, current = null, beforeClean = null } = {}) {
  if (resolved.kind !== 'mine') throw userError(MESSAGES.exampleNoDelete, 403);
  const isCurrent = sameLessonPath(current, resolved.configRel);
  const next = isCurrent ? nextLessonConfig(root, resolved.name) : null;
  const parent = path.join(root, ...DELETED_DIR.split('/'));
  fs.mkdirSync(parent, { recursive: true });
  const baseName = `${resolved.name}-${stamp(now)}`;
  let name = baseName;
  for (let i = 2; fs.existsSync(path.join(parent, name)); i += 1) name = `${baseName}_${i}`;
  try {
    fs.renameSync(resolved.abs, path.join(parent, name));
  } catch {
    throw userError(MESSAGES.deleteFailed, 409);
  }
  const data = dataId ? moveLessonData(root, dataId, path.join(parent, name)).moved : [];
  if (isCurrent) writeEnv(root, { LESSON_CONFIG: next });
  return { movedTo: `${DELETED_DIR}/${name}`, data, current: isCurrent ? { to: next } : null, cleaned: await cleanupEnvironments(root, { beforeClean }) };
}

// ===== 重命名（G4 §1）：只改 lesson.config.js 默认导出里的 title 字符串字面量（用 config-edit 的 AST 定位，注释与排版不动） =====
const propName = (p) => {
  if (p.type !== 'Property' || p.computed) return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal') return String(p.key.value);
  return null;
};
async function titleLiteral(src) {
  let obj;
  try {
    obj = await defaultObject(src);
  } catch {
    return null;
  }
  const prop = obj.properties.find((p) => propName(p) === 'title');
  const v = prop?.value;
  return v && v.type === 'Literal' && typeof v.value === 'string' ? v : null;
}

export async function renameLesson(root, resolved, { title } = {}) {
  if (resolved.kind !== 'mine') throw userError(MESSAGES.exampleNoRename, 403);
  const t = validTitle(title);
  if (!t) throw userError(MESSAGES.badTitle, 400);
  const file = path.join(resolved.abs, 'lesson.config.js');
  const src = fs.readFileSync(file, 'utf8');
  const lit = await titleLiteral(src);
  if (!lit) throw userError(MESSAGES.renameFailed, 400);
  const q = src[lit.start] === '"' ? '"' : "'";
  const out = src.slice(0, lit.start) + quoteJs(t, q) + src.slice(lit.end);
  // 写之前再解析一遍改好的源码，确认 title 正好是新课名（不对就不写）
  if ((await titleLiteral(out))?.value !== t) throw userError(MESSAGES.renameFailed, 400);
  fs.writeFileSync(file, out);
  return { title: t };
}

export async function cleanupEnvironments(root, { beforeClean = null } = {}) {
  const cleaned = [];
  try {
    const needs = await computeNeeds(root, await needsLessons(root));
    if (needs.unknown.length) return cleaned;
    for (const [kind, n] of Object.entries(needs.kinds)) {
      if (n.neededBy.length) continue;
      if (beforeClean) await beforeClean(kind);
      const dir = path.join(root, ...ENV_KINDS[kind].dir.split('/'));
      if (!fs.existsSync(dir)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      cleaned.push(kind);
    }
  } catch {
    // 清理失败不影响删课；下次删课再试
  }
  return cleaned;
}

// ===== 打开文件夹 =====
export function folderCommand(dir, platform = process.platform) {
  if (platform === 'darwin') return { cmd: 'open', args: [dir] };
  if (platform === 'win32') return { cmd: 'explorer', args: [dir] };
  return { cmd: 'xdg-open', args: [dir] };
}

// explorer 成功时退出码也常是 1，所以以"启动成功"为准
export function openFolder(dir, { platform = process.platform, spawnFn = spawn } = {}) {
  const { cmd, args } = folderCommand(dir, platform);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(cmd, args, { stdio: 'ignore', windowsHide: true, detached: platform !== 'win32' });
    } catch {
      resolve(false);
      return;
    }
    child.once('error', () => resolve(false));
    child.once('spawn', () => resolve(true));
    child.unref?.();
  });
}
