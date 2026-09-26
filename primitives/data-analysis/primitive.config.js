// data-analysis 数据分析原语（活动原语规格 §3.5）：给一份 CSV，学生用 pandas / matplotlib 看数据、算、画图；重点不是判题。
// 建在 sandbox 组件之上：数据集经 defaults.sandbox(options).files 写入学生的虚拟文件系统，配置经 classroom:state 下发。
// 用法见同目录 README.md。defaults 每项是 (options) => 值 的工厂（契约 v0.8 §五）。
// P3：options.dataset 只留元数据 { path, rows, columns }；数据内容放仅服务端选项 $server.content（活动原语规格 §2.9：
//   不下发、不计入 256 KB、不参与校验，defaults.sandbox 读它），经 sandbox.files[path] 下发一份，学生页从那里解析全量预览。
//   dataset.from 为 .xlsx 时用 readBinaryFrom 读、exceljs（按需加载，前端不打包）取第一个工作表转 CSV——此时 normalize 返回 Promise。
import { shape } from '#kernel/server/schema.js';
import { declarativeGate, validateGateSpec } from '../_shared/gate.js';
import { parseCsv } from './csv.js';
import { xlsxToCsv } from './xlsx.js';

const IDLE_MS = 8 * 60_000;
const MAX_TASKS = 8;
const HINT_MAX = 2000;
// 按 JSON 转义后的 UTF-8 长度计（数据随 sandbox 经 classroom:state 下发）；{ from } 读文件另有加载器的 256 KB 上限
export const DATASET_MAX_BYTES = 200 * 1024;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validRelPath = (p) => typeof p === 'string' && p !== '' && p.length <= 200 && !p.startsWith('/') && !p.includes('\\')
  && !p.includes('\0') && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
const kb = (n) => Math.ceil(n / 1024);

// 采集与门槛用的谓词（_shared/gate.js 的 submitted / image / ran 由本原语提供）
// hasImage：这条记录有图（服务端据此写 firstImageAt）；everImage：出过图（firstImageAt，只记一次）——门槛、提醒、推荐、芯片、轮换都用它
export const hasImage = (r) => Array.isArray(r?.images) && r.images.length > 0;
export const everImage = (r) => r?.firstImageAt != null;
export const ran = (r) => Number(r?.runs) >= 1 && !r?.error;
// P3：submitted = 上交过最终稿（finalAt）
export const submitted = (r) => r?.finalAt != null;
export const finalOf = (r) => (isPlainObject(r?.final) ? r.final : null);

// Python 单引号字符串字面量
const pyStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const isNum = (v) => v.trim() !== '' && Number.isFinite(Number(v));

// 缺省 starter：读入 CSV 并打印前几行 + 注释掉的画图示例（首列作索引、数值列求平均画柱状图；没有数值列时画首列各值的个数）
export function defaultStarter(path, table = { columns: [], rows: [] }) {
  const head = `import pandas as pd\n\ndf = pd.read_csv(${pyStr(path)})\nprint(df.head())\n`;
  const [first, ...rest] = table.columns;
  if (first == null) return head;
  const numeric = rest.filter((_, j) => {
    const vals = table.rows.map((r) => r[j + 1] ?? '').filter((v) => v.trim() !== '');
    return vals.length > 0 && vals.every(isNum);
  });
  const plot = numeric.length > 0
    ? `df.set_index(${pyStr(first)})[[${numeric.map(pyStr).join(', ')}]].mean().plot(kind='bar', title='各列平均值')`
    : `df[${pyStr(first)}].value_counts().plot(kind='bar', title='各值出现次数')`;
  return `${head}\n# 画图示例（去掉 # 运行看看）：\n# import matplotlib.pyplot as plt\n# ${plot}\n# plt.show()\n`;
}

// 数据集内容（服务端）：normalize 放在仅服务端选项 $server.content
export const datasetContent = (o) => (typeof o?.$server?.content === 'string' ? o.$server.content : '');

// 读到内容之后：限长、解析、补 dataset 元数据 / starter / gate，内容放进 $server
function finish(o, path, content) {
  if (typeof content !== 'string') throw new Error('dataset.content 必须是文本');
  const bytes = new TextEncoder().encode(JSON.stringify(content)).length;
  if (bytes > DATASET_MAX_BYTES) throw new Error(`数据集经转义后 ${kb(bytes)} KB，超过 ${kb(DATASET_MAX_BYTES)} KB，请精简行数`);
  const table = parseCsv(content);
  o.dataset = { path, rows: table.rows.length, columns: table.columns };
  o.$server = { ...(o.$server ?? {}), content };
  if (o.starter === undefined) o.starter = defaultStarter(path, table);
  if (o.gate === undefined) o.gate = o.expectImage === false ? { ran: 0.7, soft: true } : { image: 0.7, soft: true };
  return o;
}

const isXlsx = (from) => typeof from === 'string' && /\.xlsx$/i.test(from);

// 报错信息里不写具体的示例路径：前端打包含本文件，构建插件的输出扫描会把与 options 里相同的字符串当成泄露。
// dataset { path, from | content } → { path, rows, columns }，内容进 $server.content；from 用 readFrom 读（.xlsx 用 readBinaryFrom），
// 与 { from } 共用额度与路径限制；补缺省值。CSV 时同步返回，.xlsx 时返回 Promise（加载器 await）
export function normalize(raw, { readFrom, readBinaryFrom } = {}) {
  if (raw && Object.hasOwn(raw, 'preview')) throw new Error('preview 已删除：学生页显示全部数据（可排序、筛选），不用再写');
  const o = {
    tasks: [], packages: ['pandas', 'matplotlib'], expectImage: true, idleAlertMs: IDLE_MS, ...raw,
  };
  const ds = o.dataset;
  if (!isPlainObject(ds)) throw new Error('dataset 必须是 { path, from }（或 { path, content }）');
  const extra = Object.keys(ds).filter((k) => !['path', 'from', 'content'].includes(k));
  if (extra.length > 0) throw new Error(`dataset 不认识的键 ${extra.join(', ')}（可用：path、from、content）`);
  if (!validRelPath(ds.path)) throw new Error(`dataset.path 必须是相对路径（不含 ..，不以 / 开头）（得到 ${JSON.stringify(ds.path)}）`);
  if ((ds.from === undefined) === (ds.content === undefined)) throw new Error('dataset 必须写 from 或 content 之一');
  if (ds.from !== undefined) {
    if (typeof ds.from !== 'string') throw new Error('dataset.from 必须是相对阶段目录的路径字符串');
    if (isXlsx(ds.from)) {
      if (!/\.csv$/i.test(ds.path)) throw new Error('dataset.path 须以 .csv 结尾（Excel 会转成 CSV 写进这个路径）');
      if (typeof readBinaryFrom !== 'function') throw new Error('dataset.from 是 .xlsx，需要加载器提供 readBinaryFrom');
      const buf = readBinaryFrom({ from: ds.from });
      return xlsxToCsv(buf).then((csv) => finish(o, ds.path, csv));
    }
    if (typeof readFrom !== 'function') throw new Error('dataset.from 需要加载器提供 readFrom');
    return finish(o, ds.path, readFrom({ from: ds.from }));
  }
  return finish(o, ds.path, ds.content);
}

const baseShape = shape({
  prompt: 'string:1-4000',
  dataset: 'object',
  starter: 'string:0-20000',
  packages: 'array:string',
  expectImage: 'boolean',
  idleAlertMs: 'integer:0-86400000',
});
const datasetShape = shape({ path: 'string:1-200', rows: 'integer:0-1000000', columns: 'array:string' });

function validateTask(t, i) {
  if (typeof t === 'string') {
    if (t.trim() === '' || t.length > 200) throw new Error(`tasks[${i}] 必须是 1–200 字`);
    return;
  }
  if (!isPlainObject(t)) throw new Error(`tasks[${i}] 必须是字符串或 { text, hint }`);
  const extra = Object.keys(t).filter((k) => k !== 'text' && k !== 'hint');
  if (extra.length > 0) throw new Error(`tasks[${i}] 不认识的键 ${extra.join(', ')}（可用：text、hint）`);
  if (typeof t.text !== 'string' || t.text.trim() === '' || t.text.length > 200) throw new Error(`tasks[${i}].text 必须是 1–200 字`);
  if (t.hint !== undefined && (typeof t.hint !== 'string' || t.hint.trim() === '' || t.hint.length > HINT_MAX)) {
    throw new Error(`tasks[${i}].hint 必须是 1–${HINT_MAX} 字的代码片段`);
  }
}

function validate(o) {
  const { gate, tasks, ...rest } = o;
  baseShape(rest);
  if (!Array.isArray(tasks)) throw new Error('tasks 必须是数组（每项是字符串或 { text, hint }）');
  try {
    datasetShape(o.dataset);
  } catch (err) {
    throw new Error(`dataset.${err.message}（由 normalize 生成）`);
  }
  if (o.tasks.length > MAX_TASKS) throw new Error(`tasks 最多 ${MAX_TASKS} 条`);
  o.tasks.forEach(validateTask);
  validateGateSpec(gate, ['submitted', 'ran', 'image']);
  return o;
}

function idleText(ms, what) {
  const t = ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} 分钟` : `${Math.round(ms / 1000)} 秒`;
  return `${t}${what}`;
}

const NOT_FINAL = '（未上交，取最近运行）';

export default {
  type: 'data-analysis',
  label: '数据分析',
  layout: 'split',
  requiresComponents: ['sandbox'],
  options: validate,
  normalize,
  defaults: {
    // sandbox 组件的阶段配置（代码沙盒规格 §3.1 形状）：数据集写进学生虚拟文件系统的 dataset.path
    sandbox: (o) => ({ packages: o.packages, files: { [o.dataset.path]: datasetContent(o) }, starter: o.starter }),

    gate: (o) => declarativeGate(o.gate, { submitted, ran, image: everImage }),

    collect: {
      perStudent: {
        code: 'text', stdout: 'text', error: 'text', images: 'array', tests: 'object', runs: 'integer', ms: 'integer', submittedAt: 'integer',
        firstImageAt: 'integer', final: 'object', finalAt: 'integer',
      },
      perClass: { featured: 'text' },
    },

    alerts: (o) => {
      if (!(o.idleAlertMs > 0)) return [];
      const done = o.expectImage ? everImage : ran;
      return [{
        id: 'idle',
        when: (s, now) => !done(s) && s.enteredStageAt != null && now - s.enteredStageAt > o.idleAlertMs,
        text: idleText(o.idleAlertMs, o.expectImage ? '未出图' : '未跑通'),
      }];
    },

    // 首次出图（firstImageAt）最早的前 5；expectImage=false 时跑通按 submittedAt
    recommend: (o) => ({ perStudent }) => {
      const done = o.expectImage ? everImage : ran;
      const key = o.expectImage ? 'firstImageAt' : 'submittedAt';
      return Object.entries(perStudent ?? {})
        .filter(([, r]) => done(r) && typeof r[key] === 'number')
        .sort((a, b) => a[1][key] - b[1][key])
        .slice(0, 5)
        .map(([name], i) => ({ name, reason: `第 ${i + 1} 个${o.expectImage ? '出图' : '跑通'}` }));
    },

    // 出图 1 / 跑过 0.5 / 没跑 0
    score: () => (record) => {
      if (hasImage(record)) return 1;
      return Number(record?.runs) >= 1 ? 0.5 : 0;
    },

    // report 组件只显示文字：图本身不进报告，只写"已出图（1 张）"；P3：有最终稿按最终稿，没有则按最近运行并标注
    summarize: () => (record) => {
      const fin = finalOf(record);
      const src = fin ?? record;
      const mark = !fin && record ? NOT_FINAL : '';
      return [
        { label: '我的图', value: `${hasImage(src) ? '已出图（1 张）' : '未出图'}${mark}` },
        { label: '运行次数', value: Number(record?.runs) || 0 },
      ];
    },
  },
};
