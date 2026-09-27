// scripts/fetch-pyodide.mjs 的纯函数部分（代码沙盒规格 §2.3）：闭包计算、裁剪 lock、字体字符表、PyPI 轮子选择、manifest
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GB2312_HANZI } from './gb2312-hanzi.js';

export const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// 按 lock.packages[n].depends 递归求闭包；返回排序后的包名
export function computeClosure(lock, wanted) {
  const out = new Set();
  const visit = (name, from) => {
    if (out.has(name)) return;
    const p = lock?.packages?.[name];
    if (!p) throw new Error(`pyodide-lock.json 里没有包 "${name}"${from ? `（${from} 的依赖）` : ''}`);
    out.add(name);
    for (const dep of p.depends ?? []) visit(dep, name);
  };
  for (const n of wanted) visit(n, null);
  return [...out].sort();
}

// 裁剪版 lock：只保留 names 里的包，其余字段原样
export function trimLock(lock, names) {
  const keep = new Set(names);
  const packages = {};
  for (const [k, v] of Object.entries(lock.packages)) if (keep.has(k)) packages[k] = v;
  return { ...lock, packages };
}

// 常用中文标点（GB2312 第 1 区的标点与常用符号）
const CN_PUNCT = '　、。·ˉˇ¨〃々—～‖…‘’“”〔〕〈〉《》「」『』〖〗【】±×÷∶∧∨∑∏∪∩∈∷√⊥∥∠⌒⊙∫∮≡≌≈∽∝≠≮≯≤≥∞∵∴♂♀°′″℃＄¤￠￡‰§№☆★○●◎◇◆□■△▲※→←↑↓〓￥';

// 字体子集字符表：ASCII 可见字符 + 常用中文标点 + 全角 ASCII（FF01–FF5E）+ U+2212（matplotlib 负号）+ GB2312 全部汉字
export function fontCharset() {
  let s = '';
  for (let i = 0x20; i <= 0x7e; i++) s += String.fromCharCode(i);
  s += CN_PUNCT;
  for (let i = 0xff01; i <= 0xff5e; i++) s += String.fromCharCode(i);
  s += '−';
  s += GB2312_HANZI;
  return [...new Set(s)].join('');
}

// sfnt（OTF / TTF）表目录里的表标签；不是 sfnt 返回 []
export function sfntTables(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return [];
  const magic = buf.readUInt32BE(0);
  if (magic !== 0x00010000 && magic !== 0x4f54544f) return [];
  const n = buf.readUInt16BE(4);
  if (buf.length < 12 + n * 16) return [];
  const tags = [];
  for (let i = 0; i < n; i++) tags.push(buf.subarray(12 + i * 16, 16 + i * 16).toString('latin1'));
  return tags;
}

// 子集结果必须带字形轮廓（CFF / CFF2 / glyf）：harfbuzz 在 CFF 子集失败时会静默丢掉该表
export const hasOutlines = (buf) => sfntTables(buf).some((t) => t === 'CFF ' || t === 'CFF2' || t === 'glyf');

// PyPI JSON API（/pypi/<name>/<ver>/json）→ py3-none-any 轮子
export function pickWheel(json, name, version) {
  const got = json?.info?.version;
  if (got !== version) throw new Error(`PyPI ${name}: 期望版本 ${version}，得到 ${got}`);
  const u = (json.urls ?? []).find((x) => x.packagetype === 'bdist_wheel' && /-py3-none-any\.whl$/.test(x.filename));
  if (!u) throw new Error(`PyPI ${name} ${version}: 没有 py3-none-any wheel`);
  return { filename: u.filename, url: u.url, sha256: u.digests.sha256 };
}

export function buildManifest({ version, files, fetchedAt }) {
  const sorted = {};
  for (const k of Object.keys(files).sort()) sorted[k] = { size: files[k].size, sha256: files[k].sha256 };
  return { version, files: sorted, fetchedAt };
}

const GZIP_EXT = new Set(['.wasm', '.mjs', '.json', '.zip', '.otf']);
export const shouldGzip = (file) => GZIP_EXT.has(path.extname(file).toLowerCase());

// 预压缩：<file>.gz（level 9，先写 .part 再改名）；逐文件下载的第 5 步与导入整包后重生成 .gz 共用；返回 .gz 路径
export function writeGzip(file) {
  const gz = `${file}.gz`;
  fs.writeFileSync(`${gz}.part`, zlib.gzipSync(fs.readFileSync(file), { level: 9 }));
  fs.renameSync(`${gz}.part`, gz);
  return gz;
}

const withSlash = (u) => (u.endsWith('/') ? u : `${u}/`);

// 下载来源；环境变量 PYODIDE_MIRROR（发行包目录）、PYPI_MIRROR（…/pypi/）、FONT_URL 覆盖
export function sources(env, { version, fontUrl }) {
  const pyodide = withSlash(env.PYODIDE_MIRROR || `https://cdn.jsdelivr.net/pyodide/v${version}/full/`);
  const pypi = withSlash(env.PYPI_MIRROR || 'https://pypi.org/pypi/');
  return {
    pyodide,
    pypiJson: (name, ver) => `${pypi}${name}/${ver}/json`,
    font: env.FONT_URL || fontUrl,
  };
}
