// Excel → CSV（活动原语规格 §3.5，P3）：只在服务端 normalize 里用（dataset.from 为 .xlsx 时），exceljs 按需加载，前端不打包。
//   xlsxToCsv(buffer) → CSV 文本：取第一个工作表；首行为列名；列数以首行为准；整行为空的行跳过；
//   空单元格为空串；日期单元格 → YYYY-MM-DD；数字原样（String(n)）；公式取结果；富文本拼接文字；布尔 → TRUE / FALSE
//   字段含逗号、双引号、换行时加双引号（"" 转义）；行尾 \n，末尾带换行
// cellText / toCsv 是纯函数（测试直接用）。

const pad = (n) => String(n).padStart(2, '0');

export function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? '' : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t?.text ?? '').join('');
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) return cellText(v.result);
    if (typeof v.text === 'string') return v.text;
    if (typeof v.error === 'string') return v.error;
  }
  return String(v);
}

const quote = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(rows) {
  return rows.map((r) => r.map(quote).join(',')).join('\n') + (rows.length > 0 ? '\n' : '');
}

async function loadExcelJS() {
  const spec = 'exceljs';   // 变量说明符：Vite 不追踪，前端打包不带 exceljs
  const mod = await import(/* @vite-ignore */ spec);
  return mod.default ?? mod;
}

export async function xlsxToCsv(buffer) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (err) {
    throw new Error(`读取 Excel 失败（请确认是 .xlsx 文件）：${err.message}`);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Excel 里没有工作表');
  const width = ws.getRow(1).cellCount;
  if (!(width > 0)) throw new Error('Excel 第一个工作表的首行（列名）是空的');
  const rows = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    if (r > 1 && cells.every((x) => x === '')) continue;
    rows.push(cells);
  }
  return toCsv(rows);
}
