#!/usr/bin/env node
// npm run new:stage -- --lesson <lesson.config 路径> --id <id> --label <名> --primitive <vote|quiz|free-text|code|data-analysis|none> [--after <已有阶段目录>]（L1）
//   在 stagesDir 下生成 NN-<id>/（NN 为新阶段在课堂顺序里的序号，两位补零），并写进 lesson.config.js 的 stages
//   （文本改写，保留注释；--after 时插在该目录之后）：
//   - STAGE.md：阶段卡格式（docs/01-阶段卡格式.md）第四部分的阶段卡五栏 + 标题填 label + **匹配原语**：<primitive>
//   - 原语阶段：stage.config.js 从 primitives/<type>/README.md 的示例复制，id / label 换掉，options 里的示例值全部标 TODO
//     （字符串加 TODO： 前缀；键 / 枚举 / 选项键答案保留原值、行尾加 TODO 注释，见 markExampleValues）；
//     示例里 { from: './x' } 引用的文件生成占位；原语需要的组件（requiresComponents）不在 components 里时自动加上
//   - none：stage.config.js（对象字面量，layout 'focus'、gate 放行、collect 空）、server.js（空 register）、
//     Student.jsx（根 <Page template="focus">）、TeacherStats.jsx（契约 §四：统计视图不是 <Page>，只放 AlertBar + DataTable）、
//     __tests__/server.test.js 与 simulate.js 最小可跑骨架，全部带 TODO： 注释指向契约章节
//   生成后在 worker 线程里跑一次 check:lesson 并打印结果（新骨架应只有 TODO 警告；code 骨架另有一条"有测试但没有参考答案"）
//   newStage({ root, lesson, id, label, primitive, after?, quiet?, checkTests? }) → { dirName, absDir, files, addedComponents, check }
//     checkTests: false 时生成后的检查不验证代码题测试（测试用，不起 Pyodide）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STAGE_ID_RE, RESERVED_STAGE_IDS, DEFAULT_PRIMITIVES_ROOT } from '../kernel/server/stage-loader.js';
import { componentIdsOf } from '../kernel/server/component-loader.js';
import { insertArrayItem, quoteJs } from './lib/config-edit.js';
import { stageCardTemplate } from './lib/stage-card.js';
import { parseFlags } from './lib/flags.js';
import { isPlainObject, toPosix } from './lib/lesson-source.js';
import { checkLessonInWorker } from './lib/check-in-worker.js';
import { formatReport } from './check-lesson.mjs';

let fresh = 0;
// 带查询串 import：同一进程里多次生成时读到的是改后的文件
const importFresh = async (file) => (await import(`${pathToFileURL(file).href}?new-stage=${Date.now()}-${++fresh}`)).default;

export function primitiveTypes(primitivesRoot = DEFAULT_PRIMITIVES_ROOT) {
  try {
    return fs.readdirSync(primitivesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')
        && fs.existsSync(path.join(primitivesRoot, d.name, 'primitive.config.js')))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

// README 里第一个带 primitive: 的 export default 示例
export function readmeExample(primitivesRoot, type) {
  const md = fs.readFileSync(path.join(primitivesRoot, type, 'README.md'), 'utf8');
  const block = [...md.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((m) => m[1])
    .find((b) => /export\s+default\s*\{/.test(b) && /\bprimitive\s*:\s*['"]/.test(b));
  if (!block) throw new Error(`primitives/${type}/README.md 里找不到 stage.config.js 示例`);
  return block;
}

// P4：options 区里的示例值一律标出来，check:lesson 的 TODO 警告才能报出"示例没改"——
//   - 字符串值（中文、英文、数字都算，如 choices: ['21', …]）加 TODO： 前缀；
//   - 值有固定格式的键（标识符 / 枚举 / 文件名，以及 A–H 的选项键答案）加了前缀会通不过 options 校验：保留原值，行尾加 // TODO 注释；
//     answer 写成布尔（判断题）同样加注释；
//   - from 引用的文件另外生成 TODO 占位，不再标；对象的键（'test_main.py': …）不是值，不动；模板字符串不动。
const KEEP_KEYS = new Set(['id', 'key', 'type', 'showResultTo', 'path']);
const SKIP_KEYS = new Set(['from']);
const ANSWER_KEY_RE = /^[A-H]$/;

export function markExampleValues(text) {
  let out = '';
  const stack = [];           // 每层 { 或 [ 所属的键（数组元素、嵌套对象沿用）
  const kept = new Set();     // 本行保留原值的键
  let pendingKey = null;      // 最近的 "键:"，直到遇到它的值
  const keyNow = () => pendingKey ?? (stack.length ? stack[stack.length - 1] : null);
  const endLine = () => {
    if (kept.size) out += ` // TODO：核对 ${[...kept].join(' / ')}（还是示例值）`;
    kept.clear();
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      endLine();
      out += c;
      i += 1;
    } else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const line = text[i + 1] === '/';
      const found = line ? text.indexOf('\n', i) : text.indexOf('*/', i + 2);
      const j = found === -1 ? text.length : found + (line ? 0 : 2);
      out += text.slice(i, j);
      i = j;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      const raw = text.slice(i, j + 1);
      const body = text.slice(i + 1, j);
      i = j + 1;
      if (/^\s*:/.test(text.slice(i))) {          // 对象键
        pendingKey = body;
        out += raw;
        continue;
      }
      const key = keyNow();
      pendingKey = null;
      if (c === '`' || SKIP_KEYS.has(key) || body.startsWith('TODO')) out += raw;
      else if (KEEP_KEYS.has(key) || (key === 'answer' && ANSWER_KEY_RE.test(body))) {
        out += raw;
        kept.add(key);
      } else out += `${c}TODO：${body}${c}`;
    } else if (/[A-Za-z_$]/.test(c)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))[0];
      if (/^\s*:/.test(text.slice(i + word.length))) pendingKey = word;
      else if ((word === 'true' || word === 'false') && keyNow() === 'answer') {
        kept.add('answer');
        pendingKey = null;
      }
      out += word;
      i += word.length;
    } else {
      if (c === '{' || c === '[') {
        stack.push(keyNow());
        pendingKey = null;
      } else if (c === '}' || c === ']') {
        stack.pop();
        pendingKey = null;
      } else if (c === ',') pendingKey = null;
      out += c;
      i += 1;
    }
  }
  endLine();
  return out;
}

export function primitiveConfigSource(block, { type, id, label }) {
  let src = block.replace(/^(\s*\/\/[^\n]*\n)+/, '');
  src = src.replace(/(\bid\s*:\s*)(['"])(?:(?!\2)[^\\\n]|\\.)*\2/, (_m, k) => `${k}${quoteJs(id)}`);
  src = src.replace(/(\blabel\s*:\s*)(['"])(?:(?!\2)[^\\\n]|\\.)*\2/, (_m, k) => `${k}${quoteJs(label)}`);
  const at = src.search(/\boptions\s*:/);
  if (at !== -1) src = src.slice(0, at) + markExampleValues(src.slice(at));
  return `// ${label}：用原语 ${type}，options 见 primitives/${type}/README.md（npm run new:stage 从其示例复制）。
// TODO：把带 TODO 的占位换成本课内容（照同目录 STAGE.md 阶段卡），改完跑 npm run check:lesson
${src}`;
}

function placeholderFor(rel) {
  const base = path.posix.basename(rel);
  if (rel.endsWith('.py')) {
    if (/^test_/.test(base) || /(^|\/)tests\//.test(rel)) {
      return '# TODO：检查学生代码的 pytest 测试（学生看得到，不要当保密判分依据）\n\n\ndef test_placeholder():\n    assert True\n';
    }
    if (/solution/.test(base)) return '# TODO：参考答案（保密选项，只发教师；演示页点"显示参考答案"才上大屏）\n';
    return '# TODO：学生打开时看到的初始代码\n';
  }
  if (rel.endsWith('.csv')) return '列1,列2\nTODO,0\n';
  return 'TODO：\n';
}

function noneFiles({ id, label }) {
  const q = quoteJs(id);
  return {
    'stage.config.js': `// ${label}：自写阶段（primitive: null），写法见契约 §二（docs/02-阶段模块契约.md）。
// TODO：按同目录 STAGE.md 阶段卡填写 gate（E 栏）、collect（C 栏）、alerts（D 栏）；能用原语时优先用原语
export default {
  id: ${q},
  label: ${quoteJs(label)},
  primitive: null,
  layout: 'focus',             // 页面样式：focus | split | tiles | table | stack（改了要同步 Student.jsx 的 <Page template>）

  // E 推进条件（契约 §二）。TODO：按阶段卡 E 栏写门槛，如"在线学生提交率 ≥ 70%"；现在总是放行
  gate() {
    return { ok: true };
  },

  // C 采集（契约 §二）。TODO：按阶段卡 C 栏声明字段，如 perStudent: { answer: 'text', submittedAt: 'integer' }
  collect: { perStudent: {}, perClass: {} },
};
`,
    'server.js': `// ${label} 的服务端（契约 §三）。TODO：按阶段卡 B / C 栏注册学生事件，例如
//   import { shape } from '#kernel/server/schema.js';
//   ctx.on('student:answer', shape({ text: 'string:1-200' }), (socket, payload, actor) => {
//     ctx.data.set(actor.name, { text: payload.text, submittedAt: Date.now() });
//   });
// 记录里不写姓名等身份信息（契约 §三）；Student.jsx 用 send('student:answer', {…}) 发送
//
// 事件名：学生发 student:<动词>、教师发 teacher:<动词>，冒号后只能是小写字母和连字符（不能有数字、下划线、大写），
//   如 student:submit-guess；阶段自己广播用 stage:<本阶段 id>:<名词>。写错了平台启动时报错
// shape({ 键: 规则 }) 的规则（契约 §三，载荷多出没声明的键会被拒绝）：
//   'string'  'string:1-200'（长度）  'integer'  'integer:0-100'（范围）  'number'  'boolean'
//   'object'（只查是对象，不查里面）  'enum:a,b,c'（逗号分隔）  'array:string'（数组，每项按冒号后的规则）
//   'optional:<规则>'（可缺省，值为 null 也算缺省；只能写在最外层的键上）
//   没有嵌套形状：对象里面的字段写 'object'，再在 handler 里自己检查，不合法 return ctx.reject(socket, '一句话原因')
// eslint-disable-next-line no-unused-vars
export function register(ctx) {}
`,
    'Student.jsx': `// ${label} 的学生视图（契约 §四"页面与布局"）：根为 <Page>，主按钮放 <Page.Actions>，不写固定尺寸与定位。
// TODO：按阶段卡 A / B 栏写学生屏幕的内容
import { useStudentStage, Page } from '#kernel/client/index.js';

export default function Student() {
  const { stage } = useStudentStage(${q});
  return (
    <Page template="focus" title={stage?.label}>
      <Page.Main>
        <p>TODO：学生屏幕的内容</p>
      </Page.Main>
    </Page>
  );
}
`,
    'TeacherStats.jsx': `// ${label} 的教师统计视图（契约 §四）：外壳已套 table 模板，这里只放 AlertBar + DataTable + DetailModal，不是 <Page>、不放推进按钮。
// TODO：按阶段卡 D 栏定列
import { useState } from 'react';
import { useTeacherStage, AlertBar, DataTable, DetailModal } from '#kernel/client/index.js';

const columns = [
  { key: 'name', label: '姓名', accessor: (r) => r.name, sortable: true },
  // TODO：阶段卡 D 栏的列，如 { key: 'answer', label: '作答', accessor: (r) => r.answer ?? '' }
];

const pre = (value) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>;
const tabs = [{ id: 'record', label: '记录', render: (s) => pre(s.stageData?.[${q}] ?? null) }];

export default function TeacherStats() {
  const { roster, perStudent, alerts } = useTeacherStage(${q});
  const [detail, setDetail] = useState(null);
  const rows = roster.map((s) => ({ name: s.name, connected: s.connected, ...(perStudent[s.name] ?? {}) }));
  return (
    <>
      <AlertBar alerts={alerts} />
      <DataTable columns={columns} rows={rows} rowKey="name" offlineKey="connected" onRowClick={(r) => setDetail(r.name)} />
      {detail && <DetailModal name={detail} tabs={tabs} onClose={() => setDetail(null)} />}
    </>
  );
}
`,
    '__tests__/server.test.js': `// ${label} 的服务端测试（契约 §七）：node --test 运行。
// TODO：每个 ctx.on 至少一条正向、一条校验失败用例；gate 的通过与不通过各一条
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx } from '#kernel/test-utils/index.js';
import config from '../stage.config.js';
import { register } from '../server.js';

function makeCtx() {
  const ctx = mockCtx({
    stageId: ${q},
    config,
    students: [{ name: 'A', connected: true, enteredStageAt: Date.now(), enteredStageIndex: 1 }],
    data: { perStudent: {}, perClass: {} },
  });
  register(ctx);
  return ctx;
}

test('gate：骨架总是放行（TODO：换成阶段卡 E 栏的门槛测试）', async () => {
  const g = await makeCtx().gate();
  assert.equal(g.ok, true);
});
`,
    '__tests__/simulate.js': `// ${label} 的模拟课堂片段（契约 §七）：npm run simulate / npm run load 调用。
// TODO：server.js 注册学生事件后，让每个虚拟学生发一次，并在收到本人 stage:my-data 回执时 resolve，例如
//   const ack = waitForMatching(student.socket, 'stage:my-data', (p) => p?.stageId === ${q}, 5000);
//   student.send('student:answer', { text: '答' });
//   return ack;
export async function play({ students }) {
  await Promise.all(students.map((student) => loadAction({ student })));
}

// eslint-disable-next-line no-unused-vars
export function loadAction({ student }) {
  return Promise.resolve();
}
`,
  };
}

export async function newStage({
  root = process.cwd(), lesson, id, label, primitive, after, primitivesRoot = DEFAULT_PRIMITIVES_ROOT,
  quiet = false, log = (l) => console.log(l), checkTests = true,
} = {}) {
  if (typeof lesson !== 'string' || !lesson) throw new Error('请用 --lesson 给出课程配置路径（如 ./lessons/prime/lesson.config.js）');
  if (typeof id !== 'string' || !STAGE_ID_RE.test(id)) {
    throw new Error(`id ${JSON.stringify(id ?? '')} 不合法：用小写字母开头，只含小写字母、数字和连字符（如 prime-vote）`);
  }
  if (RESERVED_STAGE_IDS.includes(id)) throw new Error(`id "${id}" 是内核保留的阶段，换一个`);
  if (typeof label !== 'string' || label.trim() === '' || /[\r\n]/.test(label)) throw new Error('请用 --label 给出阶段名（一行文字，进度条上显示）');
  const types = primitiveTypes(primitivesRoot);
  if (primitive !== 'none' && !types.includes(primitive)) {
    throw new Error(`--primitive ${JSON.stringify(primitive ?? '')} 不对：可用 ${[...types, 'none'].join(' / ')}（none = 自写）`);
  }
  const absConfig = path.resolve(root, lesson);
  if (!fs.existsSync(absConfig)) throw new Error(`找不到课程配置 ${lesson}（先用 npm run new:lesson 生成）`);
  const lessonSrc = fs.readFileSync(absConfig, 'utf8');
  const lessonConfig = await importFresh(absConfig);
  if (!isPlainObject(lessonConfig) || !Array.isArray(lessonConfig.stages)) throw new Error(`${lesson} 的默认导出里没有 stages 数组`);
  const stages = lessonConfig.stages;
  const stagesRoot = path.resolve(path.dirname(absConfig), typeof lessonConfig.stagesDir === 'string' ? lessonConfig.stagesDir : './stages');

  for (const dir of stages) {
    const file = path.join(stagesRoot, String(dir), 'stage.config.js');
    if (!fs.existsSync(file)) continue;
    let other = null;
    try {
      other = (await importFresh(file))?.id;
    } catch {
      // 读不出的阶段交给 check:lesson 报
    }
    if (other === id) throw new Error(`id "${id}" 已被 ${dir} 使用，换一个`);
  }
  let index = stages.length;
  if (after !== undefined) {
    const i = stages.indexOf(after);
    if (i === -1) throw new Error(`--after ${after} 不在 stages 里（现有：${stages.join('、') || '无'}）`);
    index = i + 1;
  }
  const dirName = `${String(index + 1).padStart(2, '0')}-${id}`;
  const absDir = path.join(stagesRoot, dirName);
  if (fs.existsSync(absDir)) throw new Error(`${toPosix(path.relative(root, absDir))} 已存在，换一个 id 或先删掉那个目录`);

  // 先算好所有改动，再写文件（出错时什么都不动）
  let newLessonSrc = await insertArrayItem(lessonSrc, 'stages', dirName, { index });
  const files = {};
  const addedComponents = [];
  let layout = 'focus';
  if (primitive === 'none') {
    Object.assign(files, noneFiles({ id, label: label.trim() }));
  } else {
    const def = (await import(pathToFileURL(path.join(primitivesRoot, primitive, 'primitive.config.js')).href)).default;
    layout = def?.layout ?? 'focus';
    const cfg = primitiveConfigSource(readmeExample(primitivesRoot, primitive), { type: primitive, id, label: label.trim() });
    files['stage.config.js'] = cfg;
    for (const m of cfg.matchAll(/\bfrom\s*:\s*'(\.\/[^']+)'/g)) {
      const rel = path.posix.normalize(m[1]);
      if (!rel.startsWith('..')) files[rel] = placeholderFor(rel);
    }
    const open = componentIdsOf(lessonConfig);
    for (const cid of def?.requiresComponents ?? []) {
      if (open.includes(cid)) continue;
      newLessonSrc = await insertArrayItem(newLessonSrc, 'components', cid);
      addedComponents.push(cid);
    }
  }
  files['STAGE.md'] = stageCardTemplate({ n: index + 1, label: label.trim(), primitive: primitive === 'none' ? null : primitive, layout });

  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(absDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  fs.writeFileSync(absConfig, newLessonSrc);

  let check = null;
  try {
    check = await checkLessonInWorker(absConfig, { root, tests: checkTests });
  } catch (err) {
    if (!quiet) log(`（check:lesson 没能完成：${err?.message ?? err}）`);
  }
  if (!quiet) {
    log(`已生成 ${toPosix(path.relative(root, absDir))}/：${Object.keys(files).sort().join('、')}`);
    log(`已写进 ${toPosix(path.relative(root, absConfig))} 的 stages（第 ${index + 1} 段）${addedComponents.length ? `，并打开组件 ${addedComponents.join('、')}` : ''}`);
    const later = stages.slice(index);
    if (later.length) {
      log(`注意：后面的阶段目录（${later.join('、')}）没有重新编号——目录名前的数字只是标识，课堂顺序以 stages 为准；要改名请同时改目录名和 stages 里的写法`);
    }
    if (check) log(`\ncheck:lesson：\n${formatReport(check)}`);
  }
  return { dirName, absDir, files: Object.keys(files), addedComponents, check };
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = (l) => console.log(l) } = {}) {
  try {
    const f = parseFlags(argv, { values: ['lesson', 'id', 'label', 'primitive', 'after'] });
    const r = await newStage({ root: cwd, lesson: f.lesson, id: f.id, label: f.label, primitive: f.primitive, after: f.after, log });
    return r.check && !r.check.ok ? 1 : 0;
  } catch (err) {
    log(`new:stage 没有生成：${err?.message ?? err}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
