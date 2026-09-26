// docx 抽纯文本（M4 课程页上传教学设计；审查 A2）：不让一个"解压炸弹"拖垮管理台
//   zipEntrySizes(buf) → Map<名字, { compressed, uncompressed }> | null：只读 zip 的中央目录（不解压、无依赖）；不是 zip 返回 null
//   docxTextTooBig(buf, limit) → true：不是 zip、没有 word/document.xml、document.xml 解压后超过 limit（默认 30 MB）或是 zip64 大小
//   docxToTextInWorker(buf, { timeoutMs = 30 s, maxOldGenerationSizeMb = 512 }) → Promise<string>：
//     mammoth.extractRawText 放在 worker 线程里跑（内存上限、超时即 terminate），主线程接口照常响应；worker 出错 / 超时 / 内存不够都 reject
import { Worker } from 'node:worker_threads';

export const DOCX_XML_LIMIT = 30 * 1024 * 1024;
const WORKER = new URL('./docx-text-worker.js', import.meta.url);
const EOCD = 0x06054b50;
const CEN = 0x02014b50;

export function zipEntrySizes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  // 中央目录结束记录在文件末尾（其后最多 65535 字节注释）
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= stop; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN) return null;
    const compressed = buf.readUInt32LE(off + 20);
    const uncompressed = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    if (off + 46 + nameLen > buf.length) return null;
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    out.set(name, { compressed, uncompressed });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function docxTextTooBig(buf, limit = DOCX_XML_LIMIT) {
  const entries = zipEntrySizes(buf);
  const doc = entries?.get('word/document.xml');
  if (!doc) return true;
  // 0xFFFFFFFF：zip64，真实大小在扩展字段里，按超限处理
  return doc.uncompressed === 0xffffffff || doc.uncompressed > limit;
}

export function docxToTextInWorker(buf, { timeoutMs = 30_000, maxOldGenerationSizeMb = 512 } = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, { workerData: { buf }, resourceLimits: { maxOldGenerationSizeMb } });
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.terminate();
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('docx text timeout')), timeoutMs);
    w.once('message', (m) => (m?.ok ? done(resolve, String(m.text ?? '')) : done(reject, new Error(m?.message ?? 'docx text failed'))));
    w.once('error', (err) => done(reject, err));
    w.once('exit', (code) => done(reject, new Error(`docx worker exit ${code}`)));
  });
}
