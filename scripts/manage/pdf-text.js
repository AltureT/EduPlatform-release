// PDF 抽纯文本（S17 教案 PDF 抽文本与粘贴规格 §1）：与 docx-text.js 同一套路——库在 worker 线程里跑，主线程接口照常响应
//   pdfToTextInWorker(buf, { timeoutMs = 60 s, maxOldGenerationSizeMb = 512, maxPages = 300 }) → Promise<{ text, pages }>：
//     pdfjs-dist（legacy build，只用 getDocument + getTextContent，不渲染）；超页数 / 出错 / 超时 / 内存不够都 reject
//   pageText(items)：一页的文本项 → 文字（按 y 分行、同一行按 x 排；避免"一个字一行"）；页与页之间由 worker 空一行拼接
//   isScanned(text, pages)：平均每页非空白字符 < 20 → 当扫描件（不写 .txt，免得误导 AI）
import { Worker } from 'node:worker_threads';

export const PDF_MAX_PAGES = 300;
export const SCANNED_MIN_CHARS_PER_PAGE = 20;
const WORKER = new URL('./pdf-text-worker.js', import.meta.url);

export function pageText(items) {
  const runs = (items ?? [])
    .filter((it) => typeof it?.str === 'string' && it.str !== '' && Array.isArray(it.transform))
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || it.height || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const r of runs) {
    const line = lines.at(-1);
    // 同一行：基线差不到半个字高
    if (line && Math.abs(line.y - r.y) <= Math.max(2, Math.min(line.h, r.h) / 2)) line.runs.push(r);
    else lines.push({ y: r.y, h: r.h, runs: [r] });
  }
  return lines
    .map((l) => l.runs.sort((a, b) => a.x - b.x).map((r) => r.str).join('').trimEnd())
    .filter((s) => s.trim() !== '')
    .join('\n');
}

export function isScanned(text, pages) {
  const n = String(text ?? '').replace(/\s+/g, '').length;
  return !(pages > 0) || n / pages < SCANNED_MIN_CHARS_PER_PAGE;
}

export function pdfToTextInWorker(buf, { timeoutMs = 60_000, maxOldGenerationSizeMb = 512, maxPages = PDF_MAX_PAGES } = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, { workerData: { buf, maxPages }, resourceLimits: { maxOldGenerationSizeMb } });
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.terminate();
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('pdf text timeout')), timeoutMs);
    w.once('message', (m) => (m?.ok
      ? done(resolve, { text: String(m.text ?? ''), pages: Number(m.pages) || 0 })
      : done(reject, new Error(m?.message ?? 'pdf text failed'))));
    w.once('error', (err) => done(reject, err));
    w.once('exit', (code) => done(reject, new Error(`pdf worker exit ${code}`)));
  });
}
