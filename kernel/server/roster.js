// 名单解析（规格 §5.3、§10）：去 BOM、按行、取首列（逗号或制表符）、首行表头跳过、trim、去空、去重、丢弃 >16 字
export const MAX_NAME_LENGTH = 16;
const HEADER_RE = /^(姓名|学号|name|学生姓名)$/i;

// 数组输入按同一规则规范化：trim、去空、去重、丢弃 >16 字（非字符串项丢弃）
export function normalizeNames(names) {
  const out = [];
  const seen = new Set();
  for (const n of names || []) {
    if (typeof n !== 'string') continue;
    const t = n.trim();
    if (!t || t.length > MAX_NAME_LENGTH || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function parseRoster(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstCols = [];
  for (const line of src.split(/\r\n|\r|\n/)) {
    const col = line.split(/[,\t]/)[0].trim();
    if (col) firstCols.push(col);
  }
  if (firstCols.length > 0 && HEADER_RE.test(firstCols[0])) firstCols.shift();
  return normalizeNames(firstCols);
}
