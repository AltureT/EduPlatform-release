// 最小 zip 读写（国内镜像与 Gitee 同步规格 §3 运行时整包、§4 解压）：只用 Node 自带 zlib，不依赖系统 zip / unzip，Windows 也能用
//   writeZip(file, entries)：entries = [{ name, data: Buffer }]；能压小就 deflate，否则原样存；文件名标 UTF-8；
//     时间固定 1980-01-01（同样的内容打出同样的 zip，sha256 可复现）
//   readZip(buf) → [{ name, method, crc, compSize, size, localOffset }]（按中央目录；目录项与 __MACOSX/ 不列）
//   entryData(buf, entry) → Buffer（校验长度与 CRC）
//   safeName(name) → 规范化的相对路径（\ 换成 /）；绝对路径、盘符、.. 一律抛错
// 不支持 zip64（单文件或整包超过 4 GB、超过 65535 项；遇到明确拒绝）、加密、分卷；运行时整包约 40 MB，用不到
// 读的时候只信中央目录：支持数据描述符（flags 第 3 位）；deflate 解压上限 = 登记的长度（maxOutputLength），超出当坏包
import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

// zlib.crc32 从 Node 22.2 起才有；更早的 22.x 用表算
export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const FLAG_UTF8 = 0x0800;

export function writeZip(file, entries) {
  if (entries.length >= 0xffff) throw new Error('zip 项太多（不支持 zip64）');
  const fd = fs.openSync(file, 'w');
  let offset = 0;
  const central = [];
  const put = (b) => {
    fs.writeSync(fd, b);
    offset += b.length;
  };
  try {
    for (const { name, data } of entries) {
      const nameBuf = Buffer.from(name, 'utf8');
      const crc = crc32(data);
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      const [method, body] = deflated.length < data.length ? [8, deflated] : [0, data];
      if (offset + 30 + nameBuf.length + body.length > 0xffffffff) throw new Error('zip 太大（不支持 zip64）');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(FLAG_UTF8, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(DOS_TIME, 10);
      local.writeUInt16LE(DOS_DATE, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      const at = offset;
      put(local);
      put(nameBuf);
      put(body);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE((3 << 8) | 20, 4); // 由 Unix 生成（外部属性里放权限位）
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(FLAG_UTF8, 8);
      c.writeUInt16LE(method, 10);
      c.writeUInt16LE(DOS_TIME, 12);
      c.writeUInt16LE(DOS_DATE, 14);
      c.writeUInt32LE(crc, 16);
      c.writeUInt32LE(body.length, 20);
      c.writeUInt32LE(data.length, 24);
      c.writeUInt16LE(nameBuf.length, 28);
      c.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
      c.writeUInt32LE(at, 42);
      central.push(c, nameBuf);
    }
    const cdStart = offset;
    for (const b of central) put(b);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(offset - cdStart, 12);
    eocd.writeUInt32LE(cdStart, 16);
    put(eocd);
  } finally {
    fs.closeSync(fd);
  }
  return offset;
}

export function safeName(name) {
  const n = String(name).replace(/\\/g, '/');
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) throw new Error(`zip 里有绝对路径：${name}`);
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) throw new Error(`zip 里有越界路径：${name}`);
  return parts.join('/');
}

export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是 zip 文件（找不到目录结尾）');
  const total = buf.readUInt16LE(eocd + 10);
  const start = buf.readUInt32LE(eocd + 16);
  // zip64：目录结尾里的项数 / 偏移打满，或前面紧跟 zip64 目录结尾定位记录
  const zip64Locator = eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50;
  if (total === 0xffff || start === 0xffffffff || zip64Locator) throw new Error('不支持 zip64');
  const out = [];
  let p = start;
  for (let n = 0; n < total; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 结构不对：中央目录项签名不符');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const raw = buf.subarray(p + 46, p + 46 + nameLen);
    // 没标 UTF-8 的按 latin1 读（运行时整包里全是 ASCII 名）
    const name = raw.toString(flags & FLAG_UTF8 ? 'utf8' : 'latin1');
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new Error(`zip 里有加密项：${name}`);
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error(`不支持 zip64：${name}`);
    // flags 第 3 位（数据描述符，边压边写的 zip）：本地头里的长度与 CRC 是 0，这里只用中央目录的值，不受影响
    if (name.endsWith('/') || name.endsWith('\\')) continue;
    if (/^__MACOSX\//.test(name) || /(^|\/)\.DS_Store$/.test(name)) continue;
    out.push({ name: safeName(name), method, crc, compSize, size, localOffset });
  }
  return out;
}

export function entryData(buf, e) {
  const p = e.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`zip 结构不对：${e.name} 的本地头签名不符`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const body = buf.subarray(start, start + e.compSize);
  if (body.length !== e.compSize) throw new Error(`zip 不完整：${e.name}`);
  let data;
  if (e.method === 0) data = body;
  else if (e.method === 8) {
    // 解压上限 = 中央目录登记的长度：解出更多（压缩炸弹或目录写假）立即抛错，当坏包处理
    try {
      data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(1, e.size) });
    } catch (err) {
      throw new Error(`zip 里的 ${e.name} 已损坏（${err.code === 'ERR_BUFFER_TOO_LARGE' ? '解压后超过登记的长度' : err.message}）`);
    }
  } else throw new Error(`不支持的压缩方式 ${e.method}：${e.name}`);
  if (data.length !== e.size || crc32(data) !== e.crc) throw new Error(`zip 里的 ${e.name} 已损坏（长度或校验和不符）`);
  return data;
}
