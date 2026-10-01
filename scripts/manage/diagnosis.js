// 排障文件（S12 排障文件与 AI 排障规格 §1）：出错时在平台文件夹顶层 排障/ 写一份 Markdown，老师发给 AI 工具（或点"复制给 AI"）
//   文件名 <yyyy-MM-dd>-<HHmmss>-<环节>.md（diagnosisName；同一秒同环节已有则加 -2、-3…）；只留最近 KEEP 份（-反馈.md 不算、不删）
//   collectEnvironment(root, { env, lesson, platform, statfs, realpath, versions, version, files, manage, portOwner }) → §1.3"环境"的数据
//     （全部可注入；缺省读 root/.env、os、fs.statfsSync、fs.realpathSync.native、process.version / npm_config_user_agent、
//      currentVersion、checkPlatformFiles）；secrets = .env 里敏感键的非空值（只用于脱敏，不写进文件）
//   renderDiagnosis({ stage, phase, message, detail, environment, sections, now }) → Markdown；sections = [{ title, lines }]，
//     空段不写；脱敏（redact）与裁剪（整份 ≤ MAX_BYTES，从各段开头裁，写"（前面省略 N 行）"）在这里做
//   writeDiagnosis(root, { stage, phase, message, detail, environment?, sections, now, log }) → { file: '排障/…md', abs } | null；
//     建目录、写文件、清理旧文件；任何失败只记日志、返回 null（排障不能把工作台搞挂）
//   listDiagnoses(root) → [{ name, file, size, mtime }]（文件名倒序 = 新的在前）；readDiagnosis(root, name) → 正文
//     （name 不合 NAME_RE → 抛 status 400；不存在 → 404）
//   redact(text, secrets) / envLines(values) / tailLines(file, n) / launcherSection(root)：辅助，导出供 server.js、index.js 与测试
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEnv } from './env-file.js';
import { currentVersion } from '../lib/update-platform.js';
import { checkPlatformFiles } from '../lib/platform-files.js';

export const DIAG_DIR = '排障';
export const STAGES = ['启动入口', '安装依赖', '工作台启动', '启动平台', '平台退出', '更新', '下载运行时'];
export const KEEP = 20;
export const MAX_BYTES = 256 * 1024;
export const NAME_RE = /^\d{4}-\d{2}-\d{2}-\d{6}-[^/\\]+\.md$/;
export const LAUNCHER_LOG = 'data/logs/launcher.log';
const FEEDBACK_RE = /-反馈\.md$/;
const SECRET_KEY = /PASSWORD|KEY|TOKEN|SECRET/i;
const MIN_SECRET = 3; // 更短的值不全局替换（会把记录改得认不出来）
const MAX_LINE = 4000;
const AI_NOTE = '> 给 AI 工具：这是班迹工作台自动写的排障文件。请先读 docs/排障手册.md，按它判断是环境、课程还是平台问题，再处理。';

const pad = (n, w = 2) => String(n).padStart(w, '0');
const toDate = (now) => (now instanceof Date ? now : new Date(now ?? Date.now()));
export function fmtTime(now) {
  const d = toDate(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function diagnosisName(stage, now) {
  const d = toDate(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${stage}.md`;
}

// ===== 脱敏（规格 §1.4）=====
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  const vals = [...new Set((secrets ?? []).filter((s) => typeof s === 'string' && s.length >= MIN_SECRET))].sort((a, b) => b.length - a.length);
  for (const v of vals) out = out.replace(new RegExp(escapeRe(v), 'g'), '***');
  return out
    .replace(/([?&]t=)[^&\s#"'<>]+/g, '$1***')
    .replace(/(Bearer\s+)[^\s"',;]+/gi, '$1***')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '***');
}
export const isSecretKey = (k) => SECRET_KEY.test(k);
export function envLines(values) {
  if (!values || typeof values !== 'object') return [];
  return Object.entries(values).map(([k, v]) => (isSecretKey(k) ? `${k}=${v ? '（已填）' : '（空）'}` : `${k}=${v ?? ''}`));
}
const envSecrets = (values) => Object.entries(values ?? {}).filter(([k, v]) => isSecretKey(k) && v).map(([, v]) => String(v));

// ===== 读记录 =====
export function tailLines(file, n) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 2 * MAX_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    if (len < size) lines.shift(); // 第一行可能被截断
    return lines.slice(-n);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
export function launcherSection(root) {
  return { title: '入口脚本记录（data/logs/launcher.log 最后 60 行）', lines: tailLines(path.join(root, ...LAUNCHER_LOG.split('/')), 60) };
}

// ===== 环境（规格 §1.3）=====
function npmFromAgent(ua) {
  const m = /npm\/([\d.]+)/.exec(ua ?? '');
  return m ? m[1] : null;
}
const isRemote = (p) => typeof p === 'string' && (p.startsWith('\\\\') || p.startsWith('/Volumes/'));

export function collectEnvironment(root, {
  env,
  lesson,
  platform = { os: process.platform, release: os.release(), arch: process.arch },
  statfs = fs.statfsSync,
  realpath = fs.realpathSync.native,
  versions = { node: process.version, npm: npmFromAgent(process.env.npm_config_user_agent), execPath: process.execPath },
  version,
  files,
  manage,
  portOwner,
} = {}) {
  const abs = path.resolve(root);
  let values = env;
  let hasEnv = true;
  if (values === undefined) {
    try {
      const r = readEnv(root);
      values = r.values;
      hasEnv = r.exists;
    } catch {
      values = {};
      hasEnv = false;
    }
  }
  values ??= {};
  let ver;
  try {
    const v = version ?? currentVersion(root);
    ver = v.dev ? '开发仓库' : (v.current ?? '未知');
  } catch {
    ver = '未知';
  }
  let pf;
  try {
    const r = files ?? checkPlatformFiles(root);
    pf = !r?.checked ? '没查' : r.changes > 0 ? '是' : '否';
  } catch {
    pf = '没查';
  }
  let real;
  try {
    const r = realpath(abs);
    real = path.resolve(r) === abs || r === abs ? '同上' : r;
  } catch {
    real = '（取不到）';
  }
  let diskFree = '未知';
  try {
    const s = statfs(abs);
    const mb = Math.floor((Number(s.bavail) * Number(s.bsize)) / (1024 * 1024));
    if (Number.isFinite(mb)) diskFree = `${mb} MB`;
  } catch {
    // 未知
  }
  const vendorNode = typeof versions?.execPath === 'string'
    && path.resolve(versions.execPath).startsWith(path.join(abs, 'vendor', 'node') + path.sep);
  const lessonInfo = lesson === undefined ? (values.LESSON_CONFIG ? { path: values.LESSON_CONFIG } : null) : lesson;
  const lessonText = lessonInfo?.path
    ? `${[lessonInfo.path, lessonInfo.id].filter(Boolean).join(' · ')}${lessonInfo.title ? ` ·《${lessonInfo.title}》` : ''}`
    : '（还没有课程）';
  const port = values.PORT ?? '';
  const owner = portOwner?.name || portOwner?.pid
    ? `（被${portOwner.name ? `「${portOwner.name}」` : '别的程序'}占用${portOwner.pid ? `，进程 ${portOwner.pid}` : ''}）`
    : '';
  return {
    version: ver,
    platformFiles: pf,
    system: `${platform.os} ${platform.release} ${platform.arch}`,
    node: `${versions?.node ?? process.version}（${vendorNode ? 'vendor/node 便携版' : '系统'}）`,
    npm: versions?.npm ?? '未知',
    root: abs,
    realpath: real,
    remote: isRemote(abs) || isRemote(real),
    diskFree,
    lesson: lessonText,
    hasEnv,
    env: envLines(values),
    manage: manage?.port ? `端口 ${manage.port}${manage.startedAt ? `；启动于 ${fmtTime(manage.startedAt)}` : ''}` : '未知',
    platformPort: port ? `${port}${owner}` : '未知',
    secrets: envSecrets(values),
  };
}

// ===== 渲染（规格 §1.3）=====
function environmentLines(e) {
  const remote = e.remote ? '（网络盘或外接盘）' : '';
  return [
    '## 环境',
    `- 班迹版本：${e.version}；平台文件被改过：${e.platformFiles}`,
    `- 系统：${e.system}；Node ${e.node}；npm ${e.npm}`,
    `- 平台文件夹：${e.root}；真实路径：${e.realpath}${remote}`,
    `- 磁盘可用：${e.diskFree}`,
    `- 当前课程：${e.lesson}`,
    e.env?.length ? `- .env：\n${e.env.map((l) => `  - ${l}`).join('\n')}` : `- .env：${e.hasEnv === false ? '（没有 .env）' : '（空）'}`,
    `- 工作台：${e.manage}；平台端口：${e.platformPort}`,
  ];
}

const clip = (l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…（这一行太长，后面省略）` : l);
const fence = (lines) => {
  const body = lines.join('\n');
  const ticks = /```/.test(body) ? '````' : '```';
  return `${ticks}\n${body}\n${ticks}`;
};

export function renderDiagnosis({ stage, phase, message, detail, environment, sections = [], now } = {}) {
  const secrets = environment?.secrets ?? [];
  const r = (s) => redact(s, secrets);
  const detailLines = (Array.isArray(detail) ? detail : detail ? [detail] : []).map((l) => clip(r(String(l))));
  const head = [
    `# 排障：${stage} · ${fmtTime(now)}`,
    '',
    AI_NOTE,
    '',
    '## 发生了什么',
    `- 环节：${stage}${phase ? `（${phase}）` : ''}`,
    `- 一句话：${r(message ?? '（无）')}`,
    detailLines.length ? `- 详情：\n${detailLines.map((l) => `  - ${l}`).join('\n')}` : '- 详情：（无）',
    '',
    ...environmentLines(environment ?? {}).map(r),
    '',
    '## 最近记录',
  ].join('\n');
  const segs = (sections ?? [])
    .filter((s) => s && Array.isArray(s.lines) && s.lines.length > 0)
    .map((s) => ({ title: s.title, lines: s.lines.map((l) => clip(r(String(l)))), cut: 0 }));
  const build = () => {
    if (!segs.length) return `${head}\n（无）\n`;
    const body = segs.map((s) => [`### ${s.title}`, fence(s.cut ? [`（前面省略 ${s.cut} 行）`, ...s.lines] : s.lines)].join('\n'));
    return `${head}\n${body.join('\n\n')}\n`;
  };
  let out = build();
  // 超了：每次从当前最大的一段开头裁掉超出量（按字节估算），直到不超
  for (let guard = 0; Buffer.byteLength(out) > MAX_BYTES && guard < 1000; guard++) {
    const big = segs.filter((s) => s.lines.length).sort((a, b) => Buffer.byteLength(b.lines.join('\n')) - Buffer.byteLength(a.lines.join('\n')))[0];
    if (!big) break;
    let excess = Buffer.byteLength(out) - MAX_BYTES + 64;
    let n = 0;
    while (n < big.lines.length && excess > 0) {
      excess -= Buffer.byteLength(big.lines[n]) + 1;
      n++;
    }
    big.lines = big.lines.slice(Math.max(1, n));
    big.cut += Math.max(1, n);
    out = build();
  }
  return out;
}

// ===== 写 / 列 / 读 =====
function cleanup(dir, keep) {
  const names = fs.readdirSync(dir).filter((n) => NAME_RE.test(n) && !FEEDBACK_RE.test(n)).sort();
  for (const n of names.slice(0, Math.max(0, names.length - keep))) {
    try {
      fs.rmSync(path.join(dir, n), { force: true });
    } catch {
      // 下次再删
    }
  }
}

export function writeDiagnosis(root, { stage, phase, message, detail, environment, sections, now = new Date(), log = () => {}, keep = KEEP } = {}) {
  try {
    const env = environment ?? collectEnvironment(root);
    const text = renderDiagnosis({ stage, phase, message, detail, environment: env, sections, now });
    const dir = path.join(root, DIAG_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const base = diagnosisName(stage, now).replace(/\.md$/, '');
    let name = `${base}.md`;
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}.md`;
    const abs = path.join(dir, name);
    fs.writeFileSync(abs, text);
    cleanup(dir, keep);
    return { file: `${DIAG_DIR}/${name}`, abs };
  } catch (err) {
    try {
      log(`[manage] 排障文件没能写：${err?.message ?? err}`);
    } catch {
      // ignore
    }
    return null;
  }
}

export function listDiagnoses(root) {
  const dir = path.join(root, DIAG_DIR);
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => NAME_RE.test(n));
  } catch {
    return [];
  }
  return names.sort().reverse().map((name) => {
    let st = null;
    try {
      st = fs.statSync(path.join(dir, name));
    } catch {
      // 刚被删
    }
    return { name, file: `${DIAG_DIR}/${name}`, size: st?.size ?? 0, mtime: st?.mtimeMs ?? null };
  });
}

const httpError = (message, status) => Object.assign(new Error(message), { status, expose: true });
export function readDiagnosis(root, name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('..')) throw httpError('排障文件名不对', 400);
  const abs = path.join(root, DIAG_DIR, name);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    throw httpError('找不到这份排障文件', 404);
  }
  if (!st.isFile()) throw httpError('找不到这份排障文件', 404);
  return fs.readFileSync(abs, 'utf8');
}
