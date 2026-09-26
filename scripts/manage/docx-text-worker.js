// docx-text.js 的 worker 入口：mammoth.extractRawText，把纯文本发回主线程
import { parentPort, workerData } from 'node:worker_threads';

try {
  const { default: mammoth } = await import('mammoth');
  const r = await mammoth.extractRawText({ buffer: Buffer.from(workerData.buf) });
  parentPort.postMessage({ ok: true, text: String(r?.value ?? '') });
} catch (err) {
  parentPort.postMessage({ ok: false, message: String(err?.message ?? err) });
}
