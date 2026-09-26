// 组件声明的静态目录（K2 / v0.6）：staticDir(rootDir) → Express 中间件，由 createApp 按 component.config.js 的 static 挂载
// - 只处理 GET / HEAD；其余方法、缺文件、目录、rootDir 不存在一律 404（不调用 next()，挂在 SPA 回退之前也不会回 index.html）
// - 目录穿越（解码后解析到 rootDir 之外）→ 403
// - 预压缩：x.gz 存在且 Accept-Encoding 含 gzip → 回 x.gz，加 Content-Encoding: gzip；x.gz 存在时总带 Vary: Accept-Encoding
// - Content-Type 按原文件扩展名；缓存：URL 路径含 /v<数字> 段 → public, max-age=31536000, immutable；否则 no-cache
// - 不加任何跨源隔离头（CORP / COEP / COOP）
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.whl': 'application/octet-stream',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
};

export function contentTypeOf(file) {
  return TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

const VERSION_SEGMENT = /^v\d[\d.]*$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

function statFile(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

export function staticDir(rootDir) {
  const root = path.resolve(rootDir);

  return function staticDirMiddleware(req, res) {
    const notFound = () => res.status(404).type('text/plain').send('Not Found');
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();

    let rel;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      return res.status(400).type('text/plain').send('Bad Request');
    }
    if (rel.includes('\0')) return res.status(403).type('text/plain').send('Forbidden');
    const file = path.resolve(root, '.' + (rel.startsWith('/') ? rel : '/' + rel));
    if (file !== root && !file.startsWith(root + path.sep)) return res.status(403).type('text/plain').send('Forbidden');

    const plain = statFile(file);
    const gzFile = file + '.gz';
    const gz = statFile(gzFile);
    const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''));
    let serve = null;
    if (gz && acceptsGzip) serve = { path: gzFile, stat: gz, encoding: 'gzip' };
    else if (plain) serve = { path: file, stat: plain, encoding: null };
    if (!serve) return notFound();

    const urlPath = (req.baseUrl || '') + req.path;
    const versioned = urlPath.split('/').some((seg) => VERSION_SEGMENT.test(seg));

    res.status(200);
    res.setHeader('Content-Type', contentTypeOf(file));
    res.setHeader('Content-Length', String(serve.stat.size));
    res.setHeader('Cache-Control', versioned ? IMMUTABLE : 'no-cache');
    res.setHeader('Last-Modified', serve.stat.mtime.toUTCString());
    if (gz) res.setHeader('Vary', 'Accept-Encoding');
    if (serve.encoding) res.setHeader('Content-Encoding', serve.encoding);
    if (req.method === 'HEAD') return res.end();

    const stream = fs.createReadStream(serve.path);
    stream.on('error', () => {
      if (!res.headersSent) notFound();
      else res.destroy();
    });
    stream.pipe(res);
  };
}
