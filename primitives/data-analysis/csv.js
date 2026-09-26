// 预览用的最小 CSV 解析（活动原语规格 §3.5）：只处理逗号分隔与双引号转义（"" 表示一个引号；引号里可有逗号与换行）；
// 去掉开头的 BOM，CRLF 按换行处理。parseCsv(text, maxRows = Infinity) → { columns: 表头, rows: 前 maxRows 行数据 }
// 读到够用的行就停，不解析整份文件。纯函数，无 Node / 浏览器依赖。
export function parseCsv(text, maxRows = Infinity) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let field = '';
  let row = [];
  let quoted = false;
  let i = 0;
  const need = maxRows + 1; // 含表头
  const endRow = () => {
    row.push(field);
    field = '';
    records.push(row);
    row = [];
  };
  while (i < s.length && records.length < need) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && s[i + 1] === '\n') {
      endRow();
      i += 1;
    } else if (ch === '\n' || ch === '\r') endRow();
    else field += ch;
    i += 1;
  }
  if (records.length < need && (field !== '' || row.length > 0)) endRow();
  const [columns = [], ...rows] = records;
  return { columns, rows };
}
