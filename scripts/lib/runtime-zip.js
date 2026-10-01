// Python 运行时整包（国内镜像与 Gitee 同步规格 §3、§4）：常量、来源列表、目录校验、整包下载与导入
//   RUNTIME_RELEASE_TAG：整包挂在独立的 tag 上（与平台版本解耦，平台每版不重复上传 40 MB）；升级 Pyodide 时与 fetch-pyodide.mjs 的 PYODIDE_VERSION 一起改
//   runtimeZipName(version) → EduPlatform-runtime-v<version>.zip（ASCII，GitHub / Gitee 两边一致）
//   RUNTIME_SOURCES：按序尝试的来源（zip:<地址> = 整包；files: = 逐文件下载 jsdelivr + PyPI + 字体）
//   runtimeSources({ env, vendorDir, version }) → [{ kind: 'local' | 'zip' | 'files', url?, file?, label }]
//     第 0 来源：vendor/ 下的 EduPlatform-runtime-v<version>.zip（U 盘拷来的，不联网）；再是 RUNTIME_ZIP_URL；再是 RUNTIME_SOURCES
//   verifyRuntimeDir(pyodideDir) → { manifest, errors }：manifest.json 在、列出的每个文件都在且 sha256 对得上
//   runtimeReady(pyodideDir, { version, core }) → 已装好且校验通过（"检查并补全"时不再下载整包）
//   downloadZip(url, dest, { fetch, log, maxBytes? })：下到 dest.part，支持 Range 续传（服务端不支持就重下），完成后改名为 dest；
//     maxBytes（可选，R4 平台更新用 50 MB）：登记长度或边下边累计超过就停、删 .part、不重试；不传不限
//   installRuntimeZip(zipFile, { vendorDir, version, core, log })：解压到 vendor/.cache/runtime-staging/ →
//     按解压出的 manifest 逐文件 sha256 校验 + 内核文件对 core（fetch-pyodide.mjs 的 CORE 常量）→ 通过才替换 vendor/pyodide/，不通过整体丢弃
//   fetchRuntime({ sources, vendorDir, version, core, files, fetch, log }) → { ok, source }：按序尝试，任一成功即完成；
//     files 是逐文件下载的回调（返回错误列表）；全部失败打印"……都没连上：可以让同事把 zip 拷给你……"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, shouldGzip, writeGzip } from './pyodide-fetch.js';
import { readZip, entryData, safeName } from './zip.js';

export const RUNTIME_RELEASE_TAG = 'runtime-v314.0.7';
export const runtimeZipName = (version) => `EduPlatform-runtime-v${version}.zip`;
export const RUNTIME_ZIP_RE = /^EduPlatform-runtime-v(\d+\.\d+\.\d+)\.zip$/;
const RUNTIME_VERSION = RUNTIME_RELEASE_TAG.replace(/^runtime-v/, '');
export const RUNTIME_SOURCES = [
  `zip:https://gitee.com/alture/EduPlatform-release/releases/download/${RUNTIME_RELEASE_TAG}/${runtimeZipName(RUNTIME_VERSION)}`,
  `zip:https://github.com/AltureT/EduPlatform-release/releases/download/${RUNTIME_RELEASE_TAG}/${runtimeZipName(RUNTIME_VERSION)}`,
  'files:',
];

const RETRIES = 3;
export const MAX_UNPACKED = 200e6; // 整包原文件合计解压上限（实际约 60 MB）
export const MAX_MANIFEST = 1e6;   // 整包里 manifest.json 的解压上限（实际约 10 KB；先于其它检查，防止先解一个巨大的 manifest）
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

export function sourceLabel(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // 不是网址
  }
  if (/(^|\.)gitee\.com$/.test(host)) return '国内镜像（Gitee）';
  if (/(^|\.)github\.com$/.test(host)) return 'GitHub';
  return '自定义地址';
}

// vendor/ 下拷来的整包（浏览器重复下载会带 " (1)" 之类的后缀，也认）
export function findLocalZips(vendorDir, version) {
  const re = new RegExp(`^EduPlatform-runtime-v${version.replace(/\./g, '\\.')}(?: ?\\(\\d+\\))?\\.zip$`);
  let names = [];
  try {
    names = fs.readdirSync(vendorDir);
  } catch {
    return [];
  }
  return names.filter((n) => re.test(n)).sort().map((n) => path.join(vendorDir, n));
}

export function runtimeSources({ env = {}, vendorDir, version, sources = RUNTIME_SOURCES }) {
  const out = [];
  for (const file of findLocalZips(vendorDir, version)) out.push({ kind: 'local', file, label: `本机文件 vendor/${path.basename(file)}` });
  const custom = String(env.RUNTIME_ZIP_URL ?? '').trim().replace(/^zip:/, '');
  if (custom) out.push({ kind: 'zip', url: custom, label: '自定义地址' });
  for (const s of sources) {
    if (s === 'files:' || s === 'files') out.push({ kind: 'files', label: '逐文件下载' });
    else if (s.startsWith('zip:')) out.push({ kind: 'zip', url: s.slice(4), label: sourceLabel(s.slice(4)) });
    else throw new Error(`不认识的来源 ${s}（要以 zip: 或 files: 开头）`);
  }
  return out;
}

export function readManifest(pyodideDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pyodideDir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

// errors 为空即通过；只列前 5 个问题（完整校验 40 MB 约零点几秒）
export function verifyRuntimeDir(pyodideDir) {
  const manifest = readManifest(pyodideDir);
  if (!manifest) return { manifest: null, errors: ['没有 manifest.json（或读不出）'] };
  const files = manifest.files && typeof manifest.files === 'object' ? manifest.files : null;
  if (!manifest.version || !files || Object.keys(files).length === 0) return { manifest, errors: ['manifest.json 缺 version 或 files'] };
  const errors = [];
  for (const [rel, info] of Object.entries(files)) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(pyodideDir, ...rel.split('/')));
    } catch {
      errors.push(`缺文件 ${rel}`);
      if (errors.length >= 5) break;
      continue;
    }
    if (sha256Hex(buf) !== info?.sha256) errors.push(`sha256 不符 ${rel}`);
    if (errors.length >= 5) break;
  }
  return { manifest, errors };
}

// 内核文件（pyodide.mjs 等与原版 lock）对得上固定的 sha256：整包的 manifest 是自己写的，这里才是信任锚
function coreErrors(manifest, { version, core }) {
  const errors = [];
  for (const [name, sha] of Object.entries(core ?? {})) {
    const file = name === 'pyodide-lock.json' ? 'pyodide-lock.full.json' : name;
    if (manifest.files?.[`v${version}/${file}`]?.sha256 !== sha) errors.push(`内核文件 ${file} 与发布版本不符`);
  }
  return errors;
}

export function runtimeReady(pyodideDir, { version, core }) {
  const { manifest, errors } = verifyRuntimeDir(pyodideDir);
  if (!manifest || errors.length || manifest.version !== version || manifest.fontSubset === false) return false;
  return coreErrors(manifest, { version, core }).length === 0;
}

const httpError = (m, fatal = false) => Object.assign(new Error(m), { fatal });

// 一次下载尝试（可续传）；dest.part 已有 n 字节时带 Range: bytes=n-；服务端回 200 就从头写
const tooBig = (maxBytes) => Object.assign(httpError(`文件超过 ${mb(maxBytes)}，不像要下载的包`, true), { tooBig: true });

async function downloadOnce(url, part, { fetch: fetchImpl, log, connectMs, idleMs, maxBytes }) {
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(new Error(`${connectMs / 1000} 秒没连上`)), connectMs);
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ac.abort(new Error(`${idleMs / 1000} 秒没收到数据`)), idleMs);
  };
  let fd = null;
  try {
    let r = await fetchImpl(url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal: ac.signal, redirect: 'follow' });
    if (r.status === 416 && have > 0) {
      // 续传的起点超出文件：.part 不对，丢掉重下
      await r.body?.cancel?.();
      fs.rmSync(part, { force: true });
      have = 0;
      r = await fetchImpl(url, { signal: ac.signal, redirect: 'follow' });
    }
    if (!r.ok) throw httpError(`HTTP ${r.status}`, r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429);
    if (/text\/html/i.test(r.headers.get('content-type') ?? '')) {
      await r.body?.cancel?.();
      throw httpError('对方给的是网页不是 zip（地址不对或要登录）', true);
    }
    let append = false;
    if (r.status === 206 && have > 0) {
      const m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(r.headers.get('content-range') ?? '');
      append = Boolean(m) && Number(m[1]) === have;
    }
    if (!append) have = 0;
    const len = Number(r.headers.get('content-length'));
    const total = Number.isFinite(len) && len > 0 ? have + len : null;
    if (total && total > maxBytes) {
      await r.body?.cancel?.();
      throw tooBig(maxBytes);
    }
    if (append) log(`  接着上次的 ${mb(have)} 继续下载`);
    fd = fs.openSync(part, append ? 'a' : 'w');
    let got = have;
    let shown = -1;
    let shownBytes = 0;
    arm();
    for await (const chunk of r.body) {
      arm();
      if (got + chunk.length > maxBytes) throw tooBig(maxBytes);
      fs.writeSync(fd, chunk);
      got += chunk.length;
      if (total) {
        const pct = Math.floor((got / total) * 100);
        if (pct >= shown + 5 || got === total) {
          shown = pct - (pct % 5);
          log(`  整包 ${mb(got)} / ${mb(total)}（${pct}%）`);
        }
      } else if (got - shownBytes >= 2e6) {
        shownBytes = got;
        log(`  整包 ${mb(got)}`);
      }
    }
    if (total && got !== total) throw new Error(`下载不完整（${got} / ${total} 字节）`);
    return got;
  } catch (err) {
    if (ac.signal.aborted && ac.signal.reason instanceof Error) throw ac.signal.reason;
    throw err;
  } finally {
    clearTimeout(timer);
    if (fd != null) fs.closeSync(fd);
  }
}

export async function downloadZip(url, dest, {
  fetch: fetchImpl = globalThis.fetch, log = () => {}, connectMs = 30_000, idleMs = 60_000, retries = RETRIES, retryDelayMs = 1000,
  maxBytes = Infinity,
} = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  if (/^file:/i.test(url)) {
    if (fs.statSync(fileURLToPath(url)).size > maxBytes) throw tooBig(maxBytes);
    fs.copyFileSync(fileURLToPath(url), part);
    fs.renameSync(part, dest);
    return fs.statSync(dest).size;
  }
  let lastErr;
  for (let i = 1; i <= retries; i += 1) {
    try {
      const n = await downloadOnce(url, part, { fetch: fetchImpl, log, connectMs, idleMs, maxBytes });
      fs.renameSync(part, dest);
      return n;
    } catch (err) {
      lastErr = err;
      if (err?.tooBig) fs.rmSync(part, { force: true });
      if (err?.fatal || i === retries) break;
      log(`  断了（${err?.message ?? err}），${i * retryDelayMs / 1000} 秒后接着下…`);
      await new Promise((res) => setTimeout(res, i * retryDelayMs));
    }
  }
  throw lastErr;
}

// 包闭包的 .whl（v<ver>/ 下直接放的）按原版 lock（已被 CORE 锚定）里的 sha256 核对；裁剪版 lock 的每个包须与原版一致
// wheels/ 下的 PyPI 轮子不在 lock 里，仍只按整包的 manifest 校验
function lockErrors(stagePy, keys, version) {
  const ver = `v${version}`;
  const full = JSON.parse(fs.readFileSync(path.join(stagePy, ver, 'pyodide-lock.full.json'), 'utf8'));
  const byFile = new Map(Object.values(full.packages ?? {}).map((p) => [p?.file_name, p]));
  const errors = [];
  for (const k of keys) {
    const rel = k.slice(ver.length + 1);
    if (!rel.endsWith('.whl') || rel.includes('/')) continue;
    const p = byFile.get(rel);
    if (!p) errors.push(`${rel} 不在 pyodide-lock.full.json 里`);
    else if (sha256Hex(fs.readFileSync(path.join(stagePy, ...k.split('/')))) !== p.sha256) errors.push(`${rel} 与 pyodide-lock.full.json 的 sha256 不符`);
  }
  let trimmed;
  try {
    trimmed = JSON.parse(fs.readFileSync(path.join(stagePy, ver, 'pyodide-lock.json'), 'utf8'));
  } catch {
    return [...errors, '裁剪版 pyodide-lock.json 读不出'];
  }
  for (const [name, p] of Object.entries(trimmed.packages ?? {})) {
    if (JSON.stringify(p) !== JSON.stringify(full.packages?.[name])) errors.push(`裁剪版 pyodide-lock.json 的 ${name} 与原版不一致`);
  }
  return errors;
}

// 解压 → 校验 → 替换 vendor/pyodide；返回 { manifest, count }；失败抛错且不动 vendor/pyodide
//   不信任包里的 .gz：只解原文件，.gz 按本地原文件重新生成（writeGzip，与逐文件下载第 5 步同一做法），manifest 里 .gz 的项按重生成的写
//   合计解压大小（原文件）超过 maxTotal（默认 200 MB）直接拒绝；单项解压上限由 zip.js 按登记长度卡住
export function installRuntimeZip(zipFile, {
  vendorDir, version, core, log = () => {}, now = new Date(), maxTotal = MAX_UNPACKED,
}) {
  const buf = fs.readFileSync(zipFile);
  const entries = readZip(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const me = byName.get('pyodide/manifest.json');
  if (!me) throw new Error('zip 里没有 pyodide/manifest.json，不是运行时整包');
  if (me.size > MAX_MANIFEST) throw new Error(`zip 里的 manifest.json 过大（${me.size} 字节）`);
  let manifest;
  try {
    manifest = JSON.parse(entryData(buf, me).toString('utf8'));
  } catch (err) {
    throw new Error(`zip 里的 manifest.json 读不出：${err.message}`);
  }
  if (manifest?.version !== version) throw new Error(`整包是 ${manifest?.version ?? '未知'} 版，需要 ${version}`);
  const keys = Object.keys(manifest.files ?? {});
  if (keys.length === 0) throw new Error('整包的 manifest.json 没有文件列表');
  for (const k of keys) {
    if (safeName(k) !== k || !k.startsWith(`v${version}/`)) throw new Error(`整包的 manifest.json 里有不该有的路径 ${k}`);
  }
  const ce = coreErrors(manifest, { version, core });
  if (ce.length) throw new Error(ce.join('；'));
  const originals = keys.filter((k) => !k.endsWith('.gz'));
  let total = me.size;
  for (const k of originals) {
    const e = byName.get(`pyodide/${k}`);
    if (!e) throw new Error(`整包缺文件 ${k}`);
    total += e.size;
  }
  if (total > maxTotal) throw new Error(`整包解压后有 ${mb(total)}，超过上限 ${mb(maxTotal)}，不像运行时整包`);

  const staging = path.join(vendorDir, '.cache', 'runtime-staging');
  fs.rmSync(staging, { recursive: true, force: true });
  const stagePy = path.join(staging, 'pyodide');
  try {
    const files = {};
    for (const k of originals) {
      const data = entryData(buf, byName.get(`pyodide/${k}`));
      if (sha256Hex(data) !== manifest.files[k]?.sha256) throw new Error(`sha256 不符 ${k}`);
      const to = path.join(stagePy, ...k.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, data);
      files[k] = { size: data.length, sha256: manifest.files[k].sha256 };
    }
    const le = lockErrors(stagePy, originals, version);
    if (le.length) throw new Error(le.slice(0, 5).join('；'));
    for (const k of originals) {
      if (!shouldGzip(k)) continue;
      const gz = writeGzip(path.join(stagePy, ...k.split('/')));
      const g = fs.readFileSync(gz);
      files[`${k}.gz`] = { size: g.length, sha256: sha256Hex(g) };
    }
    const sortedFiles = {};
    for (const k of Object.keys(files).sort()) sortedFiles[k] = files[k];
    const installed = Object.keys(sortedFiles);
    // 换进 vendor/pyodide：先删 manifest（半途失败时不会被当成已就绪），再换版本目录，最后写 manifest
    const pyDir = path.join(vendorDir, 'pyodide');
    fs.mkdirSync(pyDir, { recursive: true });
    fs.rmSync(path.join(pyDir, 'manifest.json'), { force: true });
    const verDir = path.join(pyDir, `v${version}`);
    fs.rmSync(verDir, { recursive: true, force: true });
    fs.renameSync(path.join(stagePy, `v${version}`), verDir);
    // 同一时间戳：逐文件来源判断 .gz 是否过期时不会误判
    const t = now;
    for (const k of installed) fs.utimesSync(path.join(pyDir, ...k.split('/')), t, t);
    const out = { ...manifest, files: sortedFiles, fetchedAt: now.toISOString() };
    fs.writeFileSync(path.join(pyDir, 'manifest.json.part'), `${JSON.stringify(out, null, 2)}\n`);
    fs.renameSync(path.join(pyDir, 'manifest.json.part'), path.join(pyDir, 'manifest.json'));
    log(`  解压并校验通过：${installed.length} 个文件`);
    return { manifest: out, count: installed.length };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const CN_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九'];

export function failHint(version, networkCount) {
  const n = networkCount === 3 ? '三' : (CN_NUM[networkCount] ?? String(networkCount));
  return `${n}种来源都没连上：可以让同事把 ${runtimeZipName(version)} 拷给你，放进平台目录的 vendor 文件夹后再点一次`;
}

export async function fetchRuntime({
  sources, vendorDir, version, core, files, fetch: fetchImpl = globalThis.fetch, log = (m) => console.log(m), warn = (m) => console.error(m),
  downloadOptions = {}, now = () => new Date(),
}) {
  const t0 = Date.now();
  const cache = path.join(vendorDir, '.cache');
  for (const src of sources) {
    log(`来源：${src.label}`);
    if (src.kind === 'files') {
      const errors = await files();
      if (errors.length === 0) return { ok: true, source: src };
      warn(`\n✗ 逐文件下载有 ${errors.length} 项失败（manifest.json 未更新；修好网络或镜像后重跑即可续传）：`);
      for (const e of errors) warn(`  - ${e?.message ?? e}`);
      continue;
    }
    try {
      let zipFile = src.file;
      if (src.kind === 'zip') {
        zipFile = path.join(cache, path.basename(new URL(src.url).pathname) || runtimeZipName(version));
        if (!zipFile.endsWith('.zip')) zipFile += '.zip';
        await downloadZip(src.url, zipFile, { fetch: fetchImpl, log, ...downloadOptions });
      }
      log('  解压并校验…');
      try {
        installRuntimeZip(zipFile, { vendorDir, version, core, log, now: now() });
      } finally {
        // 下载来的整包用完就删（坏的也删，下次重下）；本机拷来的不删，教师可能还要拷给别人
        if (src.kind === 'zip') fs.rmSync(zipFile, { force: true });
      }
      log(`\n✓ 完成（${((Date.now() - t0) / 1000).toFixed(1)} s）→ vendor/pyodide/（${src.label}）`);
      return { ok: true, source: src };
    } catch (err) {
      log(`  ✗ 没用上：${err?.message ?? err}`);
    }
  }
  warn(failHint(version, sources.filter((s) => s.kind !== 'local').length));
  return { ok: false, source: null };
}
