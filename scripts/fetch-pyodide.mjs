#!/usr/bin/env node
// 下载 Pyodide 运行时到 vendor/pyodide/（代码沙盒规格 §2.3；内核附带，组件无关）
// 用法：npm run fetch:pyodide（G4 起有课需要时工作台自动跑它，没有下载按钮）；可重复执行：已存在且 sha256 校验通过的文件跳过，失败的下次重下
//       --sources（或 --dry-run）只列出来源顺序；--help 用法
// 多源回退（国内镜像与 Gitee 同步规格 §4，lib/runtime-zip.js）：已就绪且校验通过 → 直接完成；否则按序尝试，任一成功即完成：
//   0. vendor/ 下拷来的 EduPlatform-runtime-v<ver>.zip（不联网；导入后不删原 zip）
//   1. RUNTIME_ZIP_URL（工作台"平台"页"下载源（高级）"写进 .env，工作台起本脚本时传入）
//   2. zip: Gitee Release 整包  3. zip: GitHub Release 整包（RUNTIME_SOURCES，tag RUNTIME_RELEASE_TAG）
//   4. files: 逐文件下载（下面的原有方式）
//   每换一个来源打印"来源：国内镜像（Gitee）/ GitHub / 逐文件下载"；整包打印"整包 x / y MB（n%）"；全部失败末尾一句"……拷给你，放进 vendor 文件夹后再点一次"
// 逐文件镜像：PYODIDE_MIRROR（发行包目录，默认 https://cdn.jsdelivr.net/pyodide/v<ver>/full/）、
//       PYPI_MIRROR（默认 https://pypi.org/pypi/）、FONT_URL（字体地址）
// 产物（vendor/ 不进 git）：
//   vendor/pyodide/manifest.json            { version, files: { [相对路径]: { size, sha256 } }, fetchedAt, fontSubset }
//   vendor/pyodide/v<ver>/                  内核四件 + pyodide-lock.json（裁剪版）+ pyodide-lock.full.json（原版）+ 包闭包 .whl
//                        wheels/            Flask 及其依赖（PyPI py3-none-any）
//                        fonts/NotoSansSC-subset.otf
//                        *.gz               .wasm .mjs .json .zip .otf 预压缩；.whl 不压
//   vendor/.cache/                          原版字体（不对外提供）
// 任一文件失败 → 退出码 1，且不改写 manifest.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeClosure, trimLock, fontCharset, pickWheel, buildManifest, shouldGzip, sources, sha256Hex, hasOutlines, writeGzip,
} from './lib/pyodide-fetch.js';
import { runtimeSources, runtimeReady, fetchRuntime } from './lib/runtime-zip.js';

// ===== 常量（版本固定；升级时整组一起改并重新核对 sha256）=====
const PYODIDE_VERSION = '314.0.7';
const PACKAGES = ['numpy', 'pandas', 'matplotlib', 'pytest', 'micropip', 'jinja2', 'markupsafe'];
const PYPI = [['flask', '3.1.3'], ['werkzeug', '3.1.8'], ['itsdangerous', '2.2.0'], ['click', '8.5.0'], ['blinker', '1.9.0']];
const FONT = {
  url: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
  sha256: '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',
};
// 发行包内核文件的 sha256（lock 里没有这几项；与 npm 包 pyodide@314.0.7 的文件哈希一致）。
// pyodide-lock.json 的哈希是信任锚：各包 .whl 再按 lock 里的 sha256 校验
const CORE = {
  'pyodide.mjs': '6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109',
  'pyodide.asm.mjs': 'f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635',
  'pyodide.asm.wasm': 'cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6',
  'python_stdlib.zip': 'fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a',
  'pyodide-lock.json': '5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010',
};
const FONT_FILE = 'fonts/NotoSansSC-subset.otf';
const CONCURRENCY = 4;
const RETRIES = 3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const OUT = path.join(VENDOR, 'pyodide');
const VER = `v${PYODIDE_VERSION}`;
const VER_DIR = path.join(OUT, VER);
const CACHE = path.join(ROOT, 'vendor', '.cache');
const MANIFEST = path.join(OUT, 'manifest.json');
const SRC = sources(process.env, { version: PYODIDE_VERSION, fontUrl: FONT.url });

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
const rel = (abs) => path.relative(OUT, abs).split(path.sep).join('/');

function fileSha(file) {
  try {
    return sha256Hex(fs.readFileSync(file));
  } catch {
    return null;
  }
}

async function fetchBuffer(url) {
  let lastErr;
  for (let i = 1; i <= RETRIES; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (i < RETRIES) await new Promise((res) => setTimeout(res, 1000 * i));
    }
  }
  throw new Error(`下载失败 ${url}：${lastErr?.message ?? lastErr}`);
}

// 已存在且校验通过 → 跳过；否则下载到 .part，校验后改名
async function download(url, dest, sha256) {
  if (fileSha(dest) === sha256) return { dest, size: fs.statSync(dest).size, skipped: true };
  const buf = await fetchBuffer(url);
  const got = sha256Hex(buf);
  if (got !== sha256) throw new Error(`sha256 不符 ${url}\n  期望 ${sha256}\n  实际 ${got}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(`${dest}.part`, buf);
  fs.renameSync(`${dest}.part`, dest);
  return { dest, size: buf.length, skipped: false };
}

async function pool(tasks, n) {
  const results = [];
  const errors = [];
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const t = tasks[next++];
      try {
        results.push(await t());
      } catch (err) {
        errors.push(err);
      }
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return { results, errors };
}

function readPrevManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
}

function logResult(r) {
  console.log(`  ${r.skipped ? '已存在' : '已下载'}  ${rel(r.dest)}  ${mb(r.size)}`);
}

// files: 来源（逐文件下载，原有方式）；返回错误列表，空 = 成功（成功时写 manifest.json 并打印"✓ 完成"）
async function fetchFiles() {
  const t0 = Date.now();
  fs.mkdirSync(VER_DIR, { recursive: true });
  const errors = [];
  const sizes = { core: 0, packages: 0, wheels: 0, font: 0 };
  const produced = [];

  // 1. 内核文件 + 原版 lock
  console.log(`Pyodide ${PYODIDE_VERSION} ← ${SRC.pyodide}`);
  const coreTasks = Object.entries(CORE).map(([name, sha]) => () => {
    const dest = path.join(VER_DIR, name === 'pyodide-lock.json' ? 'pyodide-lock.full.json' : name);
    return download(SRC.pyodide + name, dest, sha);
  });
  const core = await pool(coreTasks, CONCURRENCY);
  core.results.forEach((r) => { logResult(r); sizes.core += r.size; produced.push(r.dest); });
  errors.push(...core.errors);

  // 2. 包闭包（按 lock 的 sha256）+ 裁剪版 lock
  const fullLockPath = path.join(VER_DIR, 'pyodide-lock.full.json');
  if (fileSha(fullLockPath) === CORE['pyodide-lock.json']) {
    const lock = JSON.parse(fs.readFileSync(fullLockPath, 'utf8'));
    let closure = [];
    try {
      closure = computeClosure(lock, PACKAGES);
    } catch (err) {
      errors.push(err);
    }
    console.log(`包闭包 ${closure.length} 个：${closure.join(' ')}`);
    const pkgTasks = closure.map((n) => () => {
      const p = lock.packages[n];
      return download(SRC.pyodide + p.file_name, path.join(VER_DIR, p.file_name), p.sha256);
    });
    const pk = await pool(pkgTasks, CONCURRENCY);
    pk.results.forEach((r) => { logResult(r); sizes.packages += r.size; produced.push(r.dest); });
    errors.push(...pk.errors);
    const trimmedPath = path.join(VER_DIR, 'pyodide-lock.json');
    fs.writeFileSync(trimmedPath, JSON.stringify(trimLock(lock, closure)));
    produced.push(trimmedPath);
  } else {
    errors.push(new Error('pyodide-lock.json 未就绪，跳过包闭包'));
  }

  // 3. PyPI 轮子（按 JSON API 的 digests.sha256）
  console.log(`PyPI 轮子 ← ${SRC.pypiJson('<name>', '<ver>')}`);
  const whlTasks = PYPI.map(([name, ver]) => async () => {
    const meta = await fetchBuffer(SRC.pypiJson(name, ver));
    const w = pickWheel(JSON.parse(meta.toString('utf8')), name, ver);
    return download(w.url, path.join(VER_DIR, 'wheels', w.filename), w.sha256);
  });
  const wh = await pool(whlTasks, CONCURRENCY);
  wh.results.forEach((r) => { logResult(r); sizes.wheels += r.size; produced.push(r.dest); });
  errors.push(...wh.errors);

  // 4. 中文字体子集（GB2312 汉字 + ASCII + 常用标点）；裁剪失败退回原字体并 warn
  const prev = readPrevManifest();
  const fontOut = path.join(VER_DIR, FONT_FILE);
  const fontRel = rel(fontOut);
  let fontSubset = prev?.fontSubset !== false;
  const fontUpToDate = prev?.files?.[fontRel] && prev.fontSubset !== false
    && fileSha(fontOut) === prev.files[fontRel].sha256 && hasOutlines(fs.readFileSync(fontOut));
  if (fontUpToDate) {
    const size = fs.statSync(fontOut).size;
    console.log(`  已存在  ${fontRel}  ${mb(size)}`);
    sizes.font = size;
    produced.push(fontOut);
  } else {
    try {
      console.log(`字体 ← ${SRC.font}`);
      const srcFont = path.join(CACHE, path.basename(new URL(FONT.url).pathname));
      const r = await download(SRC.font, srcFont, FONT.sha256);
      console.log(`  ${r.skipped ? '已存在' : '已下载'}  原版字体  ${mb(r.size)}`);
      const src = fs.readFileSync(srcFont);
      let out;
      try {
        const { default: subsetFont } = await import('subset-font');
        const ts = Date.now();
        // noLayoutClosure：不按 GSUB 把替代字形拉进来（matplotlib 不做 OpenType 排版）。
        // 实测 harfbuzzjs 1.6 在带版式闭包时（约 1.3 万字形）会静默丢掉 CFF 表，产出没有轮廓的字体
        out = await subsetFont(src, fontCharset(), { targetFormat: 'sfnt', noLayoutClosure: true });
        if (!out || out.length === 0) throw new Error('子集为空');
        if (!hasOutlines(out)) throw new Error('子集缺少字形轮廓表（CFF / glyf）');
        fontSubset = true;
        console.log(`  字体子集 ${[...fontCharset()].length} 字 → ${mb(out.length)}（${Date.now() - ts} ms）`);
      } catch (err) {
        console.warn(`  ⚠ 字体裁剪失败，退回原字体（约 ${mb(src.length)}）：${err?.message ?? err}`);
        out = src;
        fontSubset = false;
      }
      fs.mkdirSync(path.dirname(fontOut), { recursive: true });
      fs.writeFileSync(`${fontOut}.part`, out);
      fs.renameSync(`${fontOut}.part`, fontOut);
      sizes.font = out.length;
      produced.push(fontOut);
    } catch (err) {
      errors.push(err);
    }
  }

  if (errors.length) return errors; // fetchRuntime 打印明细，manifest.json 不改

  // 5. 预压缩（.gz 缺失或比原文件旧时重做）
  let gzTotal = 0;
  for (const f of [...produced]) {
    if (!shouldGzip(f)) continue;
    const gz = `${f}.gz`;
    const stale = !fs.existsSync(gz) || fs.statSync(gz).mtimeMs < fs.statSync(f).mtimeMs;
    if (stale) writeGzip(f);
    gzTotal += fs.statSync(gz).size;
    produced.push(gz);
  }

  // 6. manifest.json
  const files = {};
  for (const f of produced) files[rel(f)] = { size: fs.statSync(f).size, sha256: fileSha(f) };
  const manifest = { ...buildManifest({ version: PYODIDE_VERSION, files, fetchedAt: new Date().toISOString() }), fontSubset };
  fs.writeFileSync(`${MANIFEST}.part`, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(`${MANIFEST}.part`, MANIFEST);

  const raw = sizes.core + sizes.packages + sizes.wheels + sizes.font;
  console.log(`\n✓ 完成（${((Date.now() - t0) / 1000).toFixed(1)} s）→ ${path.relative(ROOT, OUT)}/`);
  console.log(`  内核 ${mb(sizes.core)} · 包闭包 ${mb(sizes.packages)} · Flask 轮子 ${mb(sizes.wheels)} · 字体${fontSubset ? '子集' : '（原版）'} ${mb(sizes.font)}`);
  console.log(`  合计 ${mb(raw)}（另有预压缩 .gz ${mb(gzTotal)}）`);
  return [];
}

const USAGE = `用法：npm run fetch:pyodide [-- --sources | --help]
  下载 Python 运行时（Pyodide ${PYODIDE_VERSION}）到 vendor/pyodide/；按来源顺序尝试，任一成功即完成
  --sources（或 --dry-run）  只列出来源顺序，不下载
  环境变量：RUNTIME_ZIP_URL（整包地址，排在网络来源最前）、PYODIDE_MIRROR / PYPI_MIRROR / FONT_URL（逐文件下载的镜像）`;

function printSources(list) {
  console.log(`Python 运行时 ${PYODIDE_VERSION} 的来源（按顺序尝试，任一成功即完成）：`);
  list.forEach((s, i) => {
    const where = s.kind === 'local' ? s.file : s.kind === 'zip' ? s.url : `${SRC.pyodide} + ${SRC.pypiJson('<name>', '<ver>')} + ${SRC.font}`;
    console.log(`  ${i + 1}. ${s.label}${s.kind === 'files' ? '' : `（${s.kind === 'local' ? '不联网' : '整包'}）`}：${where}`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const bad = args.find((a) => !['--help', '-h', '--sources', '--dry-run'].includes(a));
  if (bad) {
    console.error(`不认识的参数 ${bad}\n${USAGE}`);
    process.exit(2);
  }
  const list = runtimeSources({ env: process.env, vendorDir: VENDOR, version: PYODIDE_VERSION });
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    printSources(list);
    return;
  }
  if (args.includes('--sources') || args.includes('--dry-run')) {
    printSources(list);
    return;
  }
  // 已装好且校验通过（含内核文件的固定 sha256）→ 不再下载整包
  if (runtimeReady(OUT, { version: PYODIDE_VERSION, core: CORE })) {
    console.log(`Python 运行时 ${PYODIDE_VERSION} 已就绪，所有文件校验通过`);
    console.log('\n✓ 完成（已就绪，无需下载）→ vendor/pyodide/');
    return;
  }
  const r = await fetchRuntime({ sources: list, vendorDir: VENDOR, version: PYODIDE_VERSION, core: CORE, files: fetchFiles });
  if (!r.ok) process.exit(1);
}

main().catch((err) => {
  console.error(`✗ ${err?.stack ?? err}`);
  process.exit(1);
});
