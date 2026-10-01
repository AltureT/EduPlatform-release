// pdf-text.js 的 worker 入口：pdfjs-dist legacy build 逐页 getTextContent（不渲染、不要 canvas），把纯文本发回主线程
//   中文预置 CMap（如 UniGB-UCS2-H）从 pdfjs-dist/cmaps/ 读；超过 maxPages 页直接报错
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pageText } from './pdf-text.js';

let task = null;
try {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pkg = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  task = pdfjs.getDocument({
    data: new Uint8Array(workerData.buf),
    cMapUrl: `${path.join(pkg, 'cmaps')}${path.sep}`,
    cMapPacked: true,
    standardFontDataUrl: `${path.join(pkg, 'standard_fonts')}${path.sep}`,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  if (doc.numPages > workerData.maxPages) throw new Error(`too many pages: ${doc.numPages}`);
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    pages.push(pageText((await page.getTextContent()).items));
    page.cleanup();
  }
  parentPort.postMessage({ ok: true, text: pages.join('\n\n'), pages: doc.numPages });
} catch (err) {
  parentPort.postMessage({ ok: false, message: String(err?.message ?? err) });
} finally {
  await task?.destroy().catch(() => {});
}
