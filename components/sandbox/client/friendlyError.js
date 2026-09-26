// friendlyError(type, message, traceback) → { traceback, hint }（规格 §3.3 error.hint）
// - traceback：裁掉 Pyodide 与标准库的帧（路径含 _pyodide/、/lib/python3、pyodide/，以及 <frozen …>；家目录 /home/pyodide/ 除外），
//   保留 <exec>、main.py、tests/ 等学生文件的帧；裁完一帧不剩时连 "Traceback (most recent call last):" 一起去掉
// - hint：一行中文提示，无匹配为 null
import { IMPORT_NAMES } from '../packages.js';

const INTERNAL = [/_pyodide\//, /\/lib\/python3/, /pyodide\//, /^<frozen /];
// 学生文件在 Pyodide 的家目录（/home/pyodide/main.py、tests/…），路径里也含 "pyodide/"，先豁免
const HOME = '/home/pyodide/';
const FRAME_RE = /^ {2}File "([^"]*)"/;
const HEADER = 'Traceback (most recent call last):';
const FULLWIDTH_RE = /[：（），“”‘’；]/;
const GUI_MODULES = ['turtle', 'tkinter', '_tkinter', 'pygame'];
const FLASK_MODULES = ['flask', 'werkzeug', 'itsdangerous', 'click', 'blinker'];

export function trimTraceback(tb) {
  if (typeof tb !== 'string' || tb === '') return '';
  const lines = tb.replace(/\n$/, '').split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FRAME_RE.exec(lines[i]);
    if (!m) {
      kept.push(lines[i]);
      continue;
    }
    // 帧 = "  File …" 行 + 其后缩进 ≥ 4 的代码 / 插入符行
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith('    ')) j++;
    const file = m[1];
    const internal = !file.startsWith(HOME) && INTERNAL.some((re) => re.test(file));
    if (!internal) kept.push(...lines.slice(i, j));
    i = j - 1;
  }
  // 去掉后面没有任何帧的 Traceback 头
  const out = [];
  for (let i = 0; i < kept.length; i++) {
    if (kept[i] === HEADER && !(i + 1 < kept.length && FRAME_RE.test(kept[i + 1]))) continue;
    out.push(kept[i]);
  }
  return out.join('\n');
}

// 出错行：最后一帧的第一行代码
function errorLine(tb) {
  const lines = tb.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FRAME_RE.test(lines[i])) return lines[i + 1]?.startsWith('    ') ? lines[i + 1] : '';
  }
  return '';
}

function hintFor(type, message, tb) {
  const msg = String(message ?? '');
  if (type === 'Timeout') return '运行超时，已停止：检查是否有死循环';
  if (type === 'IndentationError' || type === 'TabError') {
    return '缩进不对：同一层的代码要对齐，冒号结尾的下一行要多缩进 4 个空格';
  }
  if (type === 'SyntaxError') {
    if (FULLWIDTH_RE.test(msg) || FULLWIDTH_RE.test(errorLine(tb))) {
      return '代码里混入了中文标点（如 ：（），“”），请切换到英文输入法重新输入这些符号';
    }
    return null;
  }
  if (type === 'NameError') {
    const name = /name '([^']+)' is not defined/.exec(msg)?.[1];
    return name
      ? `名字 ${name} 还没有定义：检查拼写和大小写，或者先赋值再使用`
      : '用到了还没有定义的名字：检查拼写和大小写，或者先赋值再使用';
  }
  if (type === 'ModuleNotFoundError') {
    const mod = /No module named '([^']+)'/.exec(msg)?.[1];
    if (!mod) return null;
    const top = mod.split('.')[0];
    if (GUI_MODULES.includes(top)) return `浏览器里没有 ${top}，本课不能使用图形窗口`;
    if (FLASK_MODULES.includes(top)) return '本阶段没有启用 Flask';
    if (IMPORT_NAMES.includes(top)) return `${top} 没有加载成功，请重启运行环境后再试`;
    return `本课未提供 ${top} 包`;
  }
  if (type === 'EOFError') return '程序在等待输入时被停止了';
  if (type === 'OSError' && msg.includes('输入通道断开')) return '输入通道断开，请重新运行';
  return null;
}

export function friendlyError(type, message, traceback) {
  const tb = trimTraceback(traceback);
  return { traceback: tb, hint: hintFor(type, message, tb) };
}
