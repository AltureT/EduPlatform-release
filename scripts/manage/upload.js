// 上传文件的读取（M4 课程页"上传教学设计"，multipart/form-data）
//   readUpload(req, { maxBytes, field = 'file' }) → { filename, data: Buffer }
//   不加依赖：把 Node 的请求流转成 Web 流，交给 Node 自带的 Request#formData()（undici 的 multipart 解析）；
//   名单上传不经服务端（页面读文本后走"粘贴"同一路径，管理台规格 §4.4），没有可复用的解析。
//   大小：声明的 Content-Length 或实际读到的字节超过 maxBytes + 表单余量 → 413；文件本身超过 maxBytes → 413。
import { Readable } from 'node:stream';
import { MESSAGES, userError } from './lesson-admin.js';

const FORM_SLACK = 64 * 1024; // 边界与字段头的余量

export async function readUpload(req, { maxBytes, field = 'file' }) {
  const type = String(req.headers['content-type'] ?? '');
  if (!/^multipart\/form-data\s*;/i.test(type)) throw userError(MESSAGES.noFile, 400);
  const limit = maxBytes + FORM_SLACK;
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume(); // 丢掉请求体，让 413 能正常送回
    throw userError(MESSAGES.tooBig, 413);
  }
  let seen = 0;
  let over = false;
  const counter = new TransformStream({
    transform(chunk, ctl) {
      seen += chunk.byteLength;
      if (seen > limit) {
        over = true;
        ctl.error(new Error('too large'));
        return;
      }
      ctl.enqueue(chunk);
    },
  });
  let form;
  try {
    const body = Readable.toWeb(req).pipeThrough(counter);
    form = await new Request('http://manage.local/upload', { method: 'POST', headers: { 'content-type': type }, body, duplex: 'half' }).formData();
  } catch {
    if (over) throw userError(MESSAGES.tooBig, 413);
    throw userError(MESSAGES.uploadFailed, 400);
  }
  const file = form.get(field);
  if (!file || typeof file === 'string') throw userError(MESSAGES.noFile, 400);
  if (file.size > maxBytes) throw userError(MESSAGES.tooBig, 413);
  return { filename: file.name, data: Buffer.from(await file.arrayBuffer()) };
}
