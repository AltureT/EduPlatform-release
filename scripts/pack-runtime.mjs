#!/usr/bin/env node
// Python 运行时整包（国内镜像与 Gitee 同步规格 §3）：npm run pack:runtime（仓库根）
//   输入 template/vendor/pyodide/：manifest.json 在、列出的每个文件 sha256 校验通过、fontSubset: true、版本与 RUNTIME_RELEASE_TAG 一致，否则报错
//   输出 <仓库根>/release/EduPlatform-runtime-v<version>.zip：pyodide/manifest.json + manifest 列出的 pyodide/v<version>/**（含 .gz 预压缩文件），
//     zip 内路径以 pyodide/ 开头；同时输出同名 .sha256（sha256sum 格式）。manifest 没列的文件（如下载中断留下的 .part）不打进去，只提示
//   zip 用 lib/zip.js（Node 自带 zlib）生成；时间戳固定，同样的 vendor 打出同样的 zip
// 导出 packRuntime({ templateDir, outDir, log, warn }) → { version, name, zipPath, shaPath, sha256, size, count }（publish:release --runtime 调用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeZip } from './lib/zip.js';
import { sha256Hex } from './lib/pyodide-fetch.js';
import { RUNTIME_RELEASE_TAG, runtimeZipName, verifyRuntimeDir } from './lib/runtime-zip.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = path.resolve(HERE, '..');

const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.isDirectory()) return walk(path.join(dir, e.name), r);
  return e.isFile() ? [r] : [];
});

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const show = (p) => {
  const r = path.relative(process.cwd(), p);
  return !r || r.startsWith('..') || path.isAbsolute(r) ? p : r;
};

export function packRuntime({
  templateDir = TEMPLATE_DIR,
  outDir = path.resolve(templateDir, '..', 'release'),
  tag = RUNTIME_RELEASE_TAG,
  log = (m) => console.log(m),
  warn = (m) => console.warn(`警告：${m}`),
} = {}) {
  const pyDir = path.join(templateDir, 'vendor', 'pyodide');
  const { manifest, errors } = verifyRuntimeDir(pyDir);
  if (!manifest) throw new Error(`${show(pyDir)}/ 里没有 manifest.json：先在 template 下运行 npm run fetch:pyodide`);
  if (errors.length) throw new Error(`vendor/pyodide 校验不通过（先重跑 npm run fetch:pyodide）：${errors.join('；')}`);
  if (manifest.fontSubset !== true) throw new Error('vendor/pyodide 的中文字体不是子集（manifest.fontSubset 不是 true）：整包会大十几 MB，先修好字体裁剪再打包');
  const { version } = manifest;
  if (tag !== `runtime-v${version}`) {
    throw new Error(`vendor/pyodide 是 ${version}，但 RUNTIME_RELEASE_TAG 是 ${tag}：升级 Pyodide 时要一起改 scripts/lib/runtime-zip.js`);
  }
  const listed = Object.keys(manifest.files).sort();
  const bad = listed.filter((r) => !r.startsWith(`v${version}/`));
  if (bad.length) throw new Error(`manifest 里有不在 v${version}/ 下的文件：${bad.slice(0, 3).join('、')}`);
  const verDir = path.join(pyDir, `v${version}`);
  const extra = walk(verDir).map((r) => `v${version}/${r}`).filter((r) => !manifest.files[r]);
  if (extra.length) warn(`v${version}/ 里有 ${extra.length} 个 manifest 没列的文件，不打进整包：${extra.slice(0, 3).join('、')}${extra.length > 3 ? ' …' : ''}`);

  const name = runtimeZipName(version);
  const zipPath = path.join(outDir, name);
  const shaPath = `${zipPath}.sha256`;
  fs.mkdirSync(outDir, { recursive: true });
  const entries = [
    { name: 'pyodide/manifest.json', data: fs.readFileSync(path.join(pyDir, 'manifest.json')) },
    ...listed.map((r) => ({ name: `pyodide/${r}`, data: fs.readFileSync(path.join(pyDir, ...r.split('/'))) })),
  ];
  const tmp = `${zipPath}.part`;
  const size = writeZip(tmp, entries);
  fs.renameSync(tmp, zipPath);
  const sha256 = sha256Hex(fs.readFileSync(zipPath));
  fs.writeFileSync(shaPath, `${sha256}  ${name}\n`);
  log(`运行时整包：${show(zipPath)} · ${mb(size)} · ${entries.length} 个文件`);
  log(`sha256：${sha256}`);
  return { version, name, zipPath, shaPath, sha256, size, count: entries.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    packRuntime();
  } catch (err) {
    console.error(`打包失败：${err.message}`);
    process.exit(1);
  }
}
