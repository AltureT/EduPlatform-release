#!/usr/bin/env node
// npm run check:lesson（L1，契约 §七"校验器"）：课程校验器。AI 生成或改完课程后跑一次，指到 文件:行 并给出怎么改。
//   node scripts/check-lesson.mjs [lesson.config 路径] [--json]
//     路径缺省读 .env 的 LESSON_CONFIG，再缺省 ./lesson.config.js；有错误退出 1；--json 输出 { ok, errors, warnings, lesson }
//   每条 = { level: 'error' | 'warning', file（相对 root 的 posix 路径）, line | null, message, fix, rule }
//   文本输出每条一行：错误 | 警告  <文件>:<行>  <一句话>  → 怎么改；末尾"通过"或"N 处错误 M 处警告"
//
// 校验项（计划 L1 Task 1）：
//   1 课程配置：调内核 loadLesson，抛的错误原样收集（加载器遇错即停，失败时再逐个阶段单独加载，把每个阶段的错误都收上来）；
//     console.warn 收成警告；另查 stages 为空（警告）、没写 stagesDir（页面构建会失败）
//   2 阶段目录：STAGE.md 必须有；stage.config.js 的默认导出过一遍构建插件 strip-stage-options 的判断（对象字面量 / 同文件顶层 const）
//   3 阶段卡结构：五栏标题缺了警告；"匹配原语"与 stage.config.primitive 不一致报错
//   4 原语阶段：collect / subPhases / layout / sandbox 与 options 错误由加载器报；阶段目录放了三个视图文件之一 → 警告"覆盖了原语默认视图"
//   5 自写阶段：Student.jsx / TeacherStats.jsx 必须有；Student 的 <Page template> 与 layout 一致（layout 非法时不比），TeacherDemo 与缺省 focus 比（警告）；
//     客户端 send / emit 的事件在 server.js 有 <对象>.on('…') 或裸 on('…') 注册，注册了而客户端从未提到的事件 → 警告
//     （正则级静态匹配；server.js 有本地 import、没有字面量注册或有非字面量事件名时，整组降为警告"无法静态确认"）
//   审查补充：阶段目录其余 .js / .jsx 的语法（parseAst）、server.js 导出 register；课程级组件过一遍 loadComponents
//   6 组件：阶段里 @components/<id>、#components/<id> 引用的组件须在 lesson.config.components 里打开
//   7 保密：原语 secretOptions 的值（≥ 8 字的字符串）不得出现在阶段目录的 .jsx / STAGE.md 里
//   8 UI 规则：阶段目录的 .jsx 过 check-ui.mjs 的 scanSource（同一进程）
//   9 模拟片段：自写阶段缺 __tests__/simulate.js → 警告
//   另：TODO 占位（new:stage 的骨架）每个文件一条警告
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { loadLesson, DEFAULT_PRIMITIVES_ROOT } from '../kernel/server/stage-loader.js';
import { componentIdsOf, loadComponents } from '../kernel/server/component-loader.js';
import stripStageOptions from '../kernel/build/strip-stage-options.js';
import { scanSource } from './check-ui.mjs';
import { STAGE_CARD_COLUMNS, parseStageCard } from './lib/stage-card.js';
import {
  isPlainObject, toPosix, lineAt, findLine, stripComments, walkFiles, loadParseAst, syntaxErrorAt, moduleFacts,
} from './lib/lesson-source.js';

export const LAYOUTS = ['focus', 'split', 'tiles', 'table', 'stack'];
const VIEW_FILES = ['Student.jsx', 'TeacherDemo.jsx', 'TeacherStats.jsx'];
const SECRET_MIN = 8;
// 审查 5：事件名后半段放宽（内核只要求 student: / teacher: 前缀，不限字符）
const EVENT = '(?:student|teacher):[a-z0-9_:-]+';
const COMPONENTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
const TEXT_EXT = /\.(js|jsx|mjs|md|py|csv|txt|json)$/;
const CONTRACT = '契约 docs/02-阶段模块契约.md';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const readText = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};
// 面向教师 / AI：不出现 undefined、堆栈
const clean = (s) => String(s ?? '')
  .split('\n')
  .filter((l) => !/^\s+at\s/.test(l))
  .join(' ')
  .replace(/\bundefined\b/g, '（没写）')
  .replace(/\s+/g, ' ')
  .trim();

// ===== 加载器错误 → 怎么改 =====
const LOADER_FIXES = [
  [/lesson config not found/, () => '检查 .env 的 LESSON_CONFIG（或命令里的路径）；新课用 npm run new:lesson 生成'],
  [/lesson config must export default an object/, () => "lesson.config.js 写成 export default { id, title, stagesDir: './stages', stages: [...] }"],
  [/stages must be an array/, () => "lesson.config.js 的 stages 写成阶段目录名数组，如 stages: ['01-vote']"],
  [/invalid stage dir/, () => 'lesson.config.js 的 stages 里每一项都是阶段目录名（非空字符串）'],
  [/missing stage\.config\.js/, () => '在这个阶段目录里建 stage.config.js（npm run new:stage 会生成整套骨架），或把目录名从 lesson.config.js 的 stages 里删掉'],
  [/stage\.config\.js must export default an object/, () => "stage.config.js 写成 export default { id, label, primitive, … }"],
  [/invalid id/, () => "id 用小写字母开头，只含小写字母、数字和连字符，如 id: 'prime-vote'"],
  [/is reserved/, () => 'prelogin / curtain 是内核保留的阶段，换一个 id'],
  [/duplicate id/, () => '两个阶段的 id 不能相同，改掉其中一个'],
  [/label must be/, () => "写上 label（进度条上显示的阶段名），如 label: '质数投票'"],
  [/must be a function/, () => '钩子（gate / onEnter / recommend 等）要写成函数；不需要就删掉这一项'],
  [/invalid primitive/, () => 'primitive 写原语目录名（vote / quiz / free-text / code / data-analysis）或 null'],
  [/subPhases must be/, () => "subPhases 写成字符串数组，如 ['judge', 'reveal']"],
  [/components must be an array/, () => "components 写成组件 id 数组，如 ['share']"],
  [/components references "([^"]+)"/, (m) => `在 lesson.config.js 的 components 里打开 '${m[1]}'，或从本阶段 stage.config.js 的 components 里删掉它`],
  [/missing server\.js/, () => "primitive 为 null 的阶段要有 server.js（export function register(ctx) {…}）；想用原语就写 primitive: 'vote' 等"],
  [/原语"([^"]+)"不存在/, () => 'primitive 改成已有的原语：vote / quiz / free-text / code / data-analysis，或 null（自写）'],
  [/需要打开组件"([^"]+)"/, (m) => `在 lesson.config.js 的 components 里加上 '${m[1]}'`],
  [/不能写 (collect|subPhases|layout|sandbox)/, (m) => `删掉 stage.config.js 里的 ${m[1]}（用原语时由原语决定）；确实需要不同的 ${m[1]} 就改成 primitive: null 自写`],
  [/提醒 id "([^"]+)" 与原语/, (m) => `把 alerts 里 id 为 '${m[1]}' 的提醒换一个 id`],
  [/不在阶段根目录|文件不存在|文件引用必须是|超过 \d+ KB|读取 .* 失败/, () => '检查 { from } 引用的文件：路径相对本阶段目录、要在阶段根目录内，单文件与合计都不超过 256 KB'],
  [/Cannot find module|ERR_MODULE_NOT_FOUND|does not provide an export/, () => '检查 import 的路径与导出名；阶段之间不能互相 import，内核只能从 #kernel/… 的公开入口引用'],
  [/Unexpected|Expected|SyntaxError|Invalid or unexpected token|missing \) after/, () => '按指出的行修正语法（括号、引号、逗号是否配对）'],
  // 课程级组件（审查 1：component-loader 的 loadComponents）
  [/component "([^"]+)": unknown component/, (m) => `把 '${m[1]}' 从 lesson.config.js 的 components 里删掉或改成已有的组件（${componentChoices()}）`],
  [/invalid component entry|component: invalid id/, () => `components 的每一项写组件 id 字符串（如 'share'）或 { id: 'sandbox', … }；已有的组件：${componentChoices()}`],
  [/duplicate id in lesson config/, () => 'components 里同一个组件只写一次'],
  [/components must be an array/, () => "components 写成数组，如 ['mirror', 'share', 'report']"],
];

function componentChoices() {
  try {
    return fs.readdirSync(COMPONENTS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(COMPONENTS_ROOT, d.name, 'component.config.js')))
      .map((d) => d.name).sort().join(' / ');
  } catch {
    return 'mirror / share / report 等';
  }
}

function loaderFix(msg, primitive) {
  const req = /(?:^|[：\s])([A-Za-z_$][\w$]*(?:\[\d+\])?(?:\.[A-Za-z_$][\w$]*)*): required\b/.exec(msg);
  if (req) return `在 options 里补上 ${req[1]}${primitive ? `（见 primitives/${primitive}/README.md 的 options 表）` : ''}`;
  for (const [re, fix] of LOADER_FIXES) {
    const m = re.exec(msg);
    if (m) return fix(m);
  }
  if (primitive) return `对照 primitives/${primitive}/README.md 的 options 表修改`;
  return `对照${CONTRACT} 修改`;
}

// 报错信息里提到的键名 / 值 → stage.config.js 里的行
const STOP = new Set(['stage', 'must', 'be', 'a', 'an', 'the', 'of', 'or', 'and', 'is', 'not', 'invalid', 'missing', 'duplicate',
  'also', 'in', 'which', 'enabled', 'lesson', 'config', 'match', 'reserved', 'non', 'empty', 'string', 'function', 'array',
  'object', 'export', 'default', 'KB', 'id', 'js', 'references', 'components', 'primitive', 'null']);
function lineForMessage(src, rawMsg) {
  if (!src) return null;
  // 去掉 阶段"<id>"： / stage "<dir>": 前缀（id 与目录名不是要找的键）
  const msg = rawMsg.replace(/^阶段"[^"]*"：/, '').replace(/^stage "[^"]*":\s*/, '');
  // 引号里的值，与 { from } 报错里的相对路径（./data/x.csv）
  const quoted = [...msg.matchAll(/"([^"\n]{1,60})"/g)].map((m) => m[1])
    .concat([...msg.matchAll(/(?:^|[\s(（])(\.{1,2}\/[^\s：:，,)（）]+)/g)].map((m) => m[1]));
  const idents = (msg.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((w) => !STOP.has(w) && w.length > 1);
  // 带数组下标的路径（items[1].choices）先取最后一段
  const pathLast = [...msg.matchAll(/[A-Za-z_]\w*(?:\[\d+\])?\.([A-Za-z_]\w*)/g)].map((m) => m[1]);
  const fallback = /invalid id/.test(msg) ? ['id'] : /components/.test(msg) ? ['components'] : /primitive/.test(msg) ? ['primitive'] : [];
  const candidates = [...pathLast, ...idents, ...quoted, ...fallback];
  for (const c of candidates) {
    const key = findLine(src, new RegExp(`(^|[\\s{,])['"]?${esc(c)}['"]?\\s*:`, 'm'));
    if (key) return key;
  }
  for (const c of quoted) {
    const val = findLine(src, new RegExp(`['"]${esc(c)}['"]`));
    if (val) return val;
  }
  return null;
}

// ===== 1 课程配置：内核加载器 =====
// 加载器遇到第一个错误就停；失败时用临时课程配置逐个阶段再加载，把每个阶段的错误都收上来（重复的只报一次）
async function runLoader(absConfig, lessonConfig, primitivesRoot) {
  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args.map(String).join(' '));
  try {
    try {
      const loaded = await loadLesson(absConfig, { primitivesRoot });
      const byDir = new Map(loaded.stages.map((s) => [path.basename(s.dir), s]));
      return { loaded, failures: [], warned, byDir };
    } catch (err) {
      const failures = [];
      const byDir = new Map();
      if (isPlainObject(lessonConfig) && Array.isArray(lessonConfig.stages)) {
        const stagesRoot = path.resolve(path.dirname(absConfig), lessonConfig.stagesDir ?? './stages');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-lesson-one-'));
        try {
          let k = 0;
          for (const dir of lessonConfig.stages) {
            if (typeof dir !== 'string' || !dir) continue;
            k += 1;
            const file = path.join(tmp, `one-${k}.lesson.config.js`);
            fs.writeFileSync(file, `export default ${JSON.stringify({
              id: 'check-one', title: 'check-one', stagesDir: stagesRoot, stages: [dir], components: componentIdsOf(lessonConfig),
            })};\n`);
            try {
              const one = await loadLesson(file, { primitivesRoot });
              byDir.set(dir, one.stages[0]);
            } catch (e) {
              failures.push({ err: e, dir });
            }
          }
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      }
      if (!failures.some((f) => f.err?.message === err?.message)) failures.push({ err, dir: null });
      return { loaded: null, failures, warned, byDir };
    }
  } finally {
    console.warn = original;
  }
}

// ===== 5 自写阶段：<Page template>、事件 =====
export function pageTemplates(src) {
  const code = stripComments(src);
  const out = [];
  const re = /<Page(?=[\s>/])/g;
  let m;
  while ((m = re.exec(code))) {
    let depth = 0;
    let end = code.length;
    for (let i = m.index + 5; i < code.length; i += 1) {
      const c = code[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) {
        end = i;
        break;
      }
    }
    const tag = code.slice(m.index, end);
    const t = /\btemplate\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)')\s*\}|(\{))/.exec(tag);
    out.push({
      line: lineAt(code, m.index),
      template: t ? (t[1] ?? t[2] ?? t[3] ?? t[4] ?? null) : undefined,
      dynamic: Boolean(t && t[5]),
    });
  }
  return out;
}

// B1：认 <任意对象>.on('…') 与解构出来的裸 on('…')（register(api)、const { on } = ctx 都合法）；
// 静态确认不了的情形（本地相对 import——事件可能在辅助模块里注册；一个字面量注册都没有；有非字面量事件名）给出原因，整组降为警告
function serverEvents(src, facts) {
  const code = stripComments(src);
  const registered = new Map();
  for (const m of code.matchAll(new RegExp(`(?<![\\w$])on\\(\\s*(['"])(${EVENT})\\1`, 'g'))) {
    if (!registered.has(m[2])) registered.set(m[2], lineAt(code, m.index));
  }
  let uncertain = null;
  if (facts?.localImports.length) uncertain = `server.js 引入了本目录的 ${facts.localImports.join('、')}，事件可能在那里注册`;
  else if (registered.size === 0) uncertain = 'server.js 里没有找到字面量写的事件注册';
  else if (/(?<![\w$])on\(\s*[^'"\s)]/.test(code)) uncertain = 'server.js 有非字面量的事件名';
  return { registered, uncertain };
}

function clientEvents(files) {
  const sends = [];
  const mentioned = new Set();
  let dynamic = false;
  for (const { abs, src } of files) {
    const code = stripComments(src);
    for (const m of code.matchAll(new RegExp(`\\b(?:send|emit)\\(\\s*(['"])(${EVENT})\\1`, 'g'))) {
      sends.push({ event: m[2], file: abs, line: lineAt(code, m.index) });
    }
    for (const m of code.matchAll(new RegExp(`(['"\`])(${EVENT})\\1`, 'g'))) mentioned.add(m[2]);
    if (/\b(?:send|emit)\(\s*[^'"\s)]/.test(code)) dynamic = true;
  }
  return { sends, mentioned, dynamic };
}

// ===== 7 保密 =====
function secretStrings(value, out = []) {
  if (typeof value === 'string') {
    if (value.trim().length >= SECRET_MIN) out.push(value.trim());
  } else if (Array.isArray(value)) value.forEach((v) => secretStrings(v, out));
  else if (isPlainObject(value)) Object.values(value).forEach((v) => secretStrings(v, out));
  return out;
}

// ===== 8 UI 规则：check-ui 的 rule → 怎么改 =====
const UI_FIXES = {
  position: '覆盖层用内核 Overlay，其余内容放进 <Page> 的区域（Page.Main / Side / Actions）',
  size: '删掉固定尺寸，交给 <Page> 与布局原语（Fill / Split / Tiles / Stack）',
  'viewport-unit': '去掉 vh / vw，要撑满用 <Fill>',
  media: '去掉 @media，窄屏由外壳处理，组件里需要时用 useNarrow()',
  'page-root': '默认导出组件的根改成 <Page template="…">（契约 §四"页面与布局"；三元两个分支都要是 <Page>）',
  advance: '删掉推进按钮：推进在外壳操作条，TeacherStats / TeacherDemo 不放 advance(…)',
};

// ===== 主流程 =====
export async function checkLesson(configPath, {
  root = process.cwd(), primitivesRoot = DEFAULT_PRIMITIVES_ROOT, componentsRoot = COMPONENTS_ROOT,
} = {}) {
  const absConfig = path.resolve(root, configPath);
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const rel = (abs) => {
    const r = toPosix(path.relative(root, abs));
    return r && !r.startsWith('..') ? r : toPosix(abs);
  };
  const add = (level, file, line, message, fix, rule) => {
    const item = { level, file: file ? rel(file) : null, line: Number.isInteger(line) ? line : null, message: clean(message), fix: clean(fix), rule };
    const key = `${level}|${item.file}|${item.line}|${item.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    (level === 'error' ? errors : warnings).push(item);
  };
  const error = (...a) => add('error', ...a);
  const warn = (...a) => add('warning', ...a);
  const lesson = { path: toPosix(configPath), title: null, stageCount: 0 };
  const lessonSrc = readText(absConfig);

  // 我们自己也读一次课程配置（静态检查要用 stagesDir / stages / components）；读不出由加载器报
  let lessonConfig = null;
  if (lessonSrc !== null) {
    try {
      lessonConfig = (await import(pathToFileURL(absConfig).href)).default;
    } catch {
      lessonConfig = null;
    }
  }
  if (isPlainObject(lessonConfig)) {
    lesson.title = typeof lessonConfig.title === 'string' ? lessonConfig.title : null;
    lesson.stageCount = Array.isArray(lessonConfig.stages) ? lessonConfig.stages.length : 0;
  }
  const stagesRoot = path.resolve(path.dirname(absConfig), isPlainObject(lessonConfig) && typeof lessonConfig.stagesDir === 'string' ? lessonConfig.stagesDir : './stages');
  const stageDirs = isPlainObject(lessonConfig) && Array.isArray(lessonConfig.stages) ? lessonConfig.stages.filter((d) => typeof d === 'string' && d) : [];

  // 各阶段原始 stage.config.js（不校验，只取 id / primitive / layout 给静态检查用）
  const raw = new Map();
  for (const dir of stageDirs) {
    const file = path.join(stagesRoot, dir, 'stage.config.js');
    const entry = { file, src: readText(file), config: null, importError: null };
    if (entry.src !== null) {
      try {
        entry.config = (await import(pathToFileURL(file).href)).default;
      } catch (err) {
        entry.importError = err;
      }
    }
    raw.set(dir, entry);
  }
  const dirOfId = (id) => [...raw.entries()].find(([, e]) => isPlainObject(e.config) && e.config.id === id)?.[0] ?? null;

  // 1 课程配置
  const { loaded, failures, warned, byDir } = await runLoader(absConfig, lessonConfig, primitivesRoot);
  for (const { err, dir: knownDir } of failures) {
    const msg = String(err?.message ?? err);
    let dir = knownDir ?? /stage "([^"]+)"/.exec(msg)?.[1] ?? dirOfId(/阶段"([^"]+)"/.exec(msg)?.[1]);
    if (dir && !raw.has(dir)) dir = null;
    // 审查 6：阶段目录整个不存在 → 指到 lesson.config.js 里写这个目录名的那一行
    if (dir && /missing stage\.config\.js/.test(msg) && !fs.existsSync(path.join(stagesRoot, dir))) {
      error(absConfig, findLine(lessonSrc, new RegExp(`['"\`]${esc(dir)}['"\`]`)) ?? findLine(lessonSrc, /^\s*stages\s*:/m),
        `阶段目录 ${dir} 不存在（${rel(path.join(stagesRoot, dir))}）`,
        `用 npm run new:stage 生成这个阶段，或把 '${dir}' 从 lesson.config.js 的 stages 里删掉；目录名要与 stages 里写的完全一致`, 'loader');
      continue;
    }
    let file = absConfig;
    let src = lessonSrc;
    const imported = /imported from (\S+)/.exec(msg)?.[1];
    if (dir) {
      const e = raw.get(dir);
      file = /missing server\.js/.test(msg) ? path.join(stagesRoot, dir, 'server.js') : e.file;
      src = file === e.file ? e.src : null;
    } else if (imported && fs.existsSync(imported)) {
      file = imported;
      src = readText(imported);
    }
    let line = null;
    if (src && /Unexpected|Expected|SyntaxError|Invalid or unexpected|missing \)/.test(`${err?.name} ${msg}`)) line = (await syntaxErrorAt(src))?.line ?? null;
    if (line === null && src && !/missing /.test(msg)) line = lineForMessage(src, msg);
    const primitive = dir && isPlainObject(raw.get(dir).config) ? raw.get(dir).config.primitive : null;
    // 审查 6：原语 options 的错误（如缺必填键）找不到具体行时，退到 options: 那一行
    if (line === null && src && dir && typeof primitive === 'string' && /^阶段"/.test(msg)) {
      line = findLine(src, /^\s*options\s*:/m) ?? findLine(src, /^\s*primitive\s*:/m);
    }
    error(file, line, msg, loaderFix(msg, typeof primitive === 'string' ? primitive : null), 'loader');
  }

  // 审查 1：课程级组件（内核加载器只取 id，组件本身由 component-loader 在启动时加载）
  if (isPlainObject(lessonConfig)) {
    try {
      await loadComponents(lessonConfig, componentsRoot);
    } catch (err) {
      const msg = String(err?.message ?? err).replace(`${componentsRoot}${path.sep}`, 'components/');
      const id = /component "([^"]+)"/.exec(msg)?.[1];
      const line = (id ? findLine(lessonSrc, new RegExp(`['"\`]${esc(id)}['"\`]`)) : null) ?? findLine(lessonSrc, /^\s*components\s*:/m);
      error(absConfig, line, msg, loaderFix(msg, null), 'components');
    }
  }
  for (const w of warned) {
    const dir = dirOfId(/阶段"([^"]+)"/.exec(w)?.[1]);
    const e = dir ? raw.get(dir) : null;
    const isOptions = /options 不会生效/.test(w);
    warn(e ? e.file : absConfig, e && isOptions ? findLine(e.src, /^\s*options\s*:/m) : null, w,
      isOptions ? "删掉 options，或写 primitive: 'vote' 等选一个原语（只有原语阶段读 options）" : `对照${CONTRACT} 修改`, 'loader');
  }

  if (isPlainObject(lessonConfig)) {
    if (Array.isArray(lessonConfig.stages) && lessonConfig.stages.length === 0) {
      warn(absConfig, findLine(lessonSrc, /^\s*stages\s*:/m), '课程还没有阶段',
        `用 npm run new:stage -- --lesson ${lesson.path} --id <id> --label <名> --primitive <原语> 添加第一个阶段`, 'lesson');
    }
    if (typeof lessonConfig.stagesDir !== 'string' || !lessonConfig.stagesDir) {
      error(absConfig, findLine(lessonSrc, /^\s*stages\s*:/m), '没有写 stagesDir，页面构建会失败（平台服务端缺省用 ./stages，前端打包不会）',
        "在 lesson.config.js 里加一行 stagesDir: './stages',（相对本文件所在目录）", 'lesson');
    }
    todoCheck(absConfig, lessonSrc, warn);
  }

  const openComponents = isPlainObject(lessonConfig) ? componentIdsOf(lessonConfig) : [];
  const knownPrimitives = subdirs(primitivesRoot).filter((d) => !d.startsWith('_'));
  const parseAst = stageDirs.length ? await loadParseAst() : null;
  const strip = stageDirs.length ? stripStageOptions({ stagesRoot }) : null;

  for (const dir of stageDirs) {
    const absDir = path.join(stagesRoot, dir);
    if (!fs.existsSync(absDir)) continue; // 加载器已报 missing stage.config.js
    const e = raw.get(dir);
    const cfg = isPlainObject(e.config) ? e.config : null;
    const isPrimitive = cfg ? cfg.primitive != null : null;
    const loadedStage = (loaded ? loaded.stages.find((s) => path.basename(s.dir) === dir) : null) ?? byDir.get(dir) ?? null;
    const files = walkFiles(absDir);
    const has = (f) => files.includes(f);
    const at = (f) => path.join(absDir, f);
    const noTests = files.filter((f) => !f.startsWith('__tests__/'));

    // 2 阶段目录
    if (!has('STAGE.md')) {
      error(at('STAGE.md'), null, '阶段目录缺 STAGE.md（阶段卡）', '照 docs/01 阶段卡模板写 STAGE.md（npm run new:stage 会生成），五栏 A–E 与"匹配原语"一行', 'stage-card');
    }
    if (e.src !== null && !e.importError) {
      try {
        strip.transform.call({
          parse: (code) => parseAst(code),
          error: (m) => { throw new Error(typeof m === 'string' ? m : m.message); },
        }, e.src, e.file);
      } catch (err) {
        const text = String(err?.message ?? err);
        const why = text.replace(/^\[strip-stage-options\][^：]*：/, '').split('。')[0];
        error(e.file, findLine(e.src, /\bexport\s+default\b/) ?? findLine(e.src, /\bexport\b/) ?? 1,
          `stage.config.js 的写法不合规，页面构建会失败：${why}`,
          "改成 export default { id, label, primitive, options: {…} }（对象字面量），或 const cfg = {…}; export default cfg;（同文件顶层 const）；顶层不要用展开或计算属性名", 'build');
      }
    }

    // 审查 2：阶段里其余代码文件的语法（stage.config.js 由加载器报）；server.js 须导出 register（契约 §三）
    for (const f of noTests.filter((x) => /\.(jsx?|mjs)$/.test(x) && x !== 'stage.config.js')) {
      const src = readText(at(f)) ?? '';
      const syn = await syntaxErrorAt(src, { lang: f.endsWith('.jsx') ? 'jsx' : undefined });
      if (syn) {
        error(at(f), syn.line, `${path.posix.basename(f)} 有语法错误：${syn.message}`, '按指出的行修正语法（括号、引号、逗号、标签是否配对）', 'syntax');
        continue;
      }
      if (f === 'server.js') {
        const facts = await moduleFacts(src);
        if (facts && !facts.exports.has('register') && !facts.exports.has('*')) {
          error(at(f), findLine(src, /\bregister\b/), 'server.js 没有导出 register，平台启动时会失败',
            `写成 export function register(ctx) { … }（${CONTRACT} §三）`, 'server-export');
        }
      }
    }

    // 3 阶段卡结构
    const cardSrc = has('STAGE.md') ? readText(at('STAGE.md')) : null;
    if (cardSrc !== null) {
      const card = parseStageCard(cardSrc);
      for (const c of STAGE_CARD_COLUMNS) {
        if (card.columns[c.key] === null) {
          warn(at('STAGE.md'), null, `阶段卡缺少"**${c.title}**"一栏`, `照 docs/01 阶段卡模板补上"**${c.title}**"这一栏`, 'stage-card');
        }
      }
      if (!card.primitive) {
        warn(at('STAGE.md'), null, '阶段卡缺少"**匹配原语**："一行',
          `加一行 **匹配原语**：${cfg?.primitive ?? '无（自写）'}（与 stage.config.js 的 primitive 一致）`, 'stage-card');
      } else if (cfg) {
        const { token, value, line } = card.primitive;
        if (cfg.primitive != null && token !== cfg.primitive) {
          error(at('STAGE.md'), line, `阶段卡的匹配原语写的是"${value || '（空）'}"，stage.config.js 的 primitive 是 '${cfg.primitive}'`,
            `两边改成一致：阶段卡写 **匹配原语**：${cfg.primitive}，或把 stage.config.js 的 primitive 改成阶段卡里的原语`, 'stage-card');
        } else if (cfg.primitive == null && token && knownPrimitives.includes(token)) {
          error(at('STAGE.md'), line, `阶段卡的匹配原语写的是原语 ${token}，stage.config.js 的 primitive 却是 null（自写）`,
            `两边改成一致：用原语就在 stage.config.js 写 primitive: '${token}'；自写就把阶段卡改成 **匹配原语**：无（自写）`, 'stage-card');
        } else if (cfg.primitive == null && !value) {
          warn(at('STAGE.md'), line, '阶段卡的匹配原语没填', '自写阶段写 **匹配原语**：无（自写）', 'stage-card');
        }
      }
    }

    if (isPrimitive === true) {
      // 4 原语阶段：覆盖视图
      for (const v of VIEW_FILES) {
        if (has(v)) {
          warn(at(v), null, `${v} 覆盖了原语默认视图，确认是有意为之`,
            `不需要覆盖就删掉 ${v}；要覆盖就保留（事件、采集与门槛仍由原语 ${cfg.primitive} 提供）`, 'primitive-override');
        }
      }
    } else if (isPrimitive === false) {
      // 5 自写阶段
      for (const v of ['Student.jsx', 'TeacherStats.jsx']) {
        if (!has(v)) {
          error(at(v), null, `自写阶段（primitive: null）缺 ${v}`,
            `建 ${v}（npm run new:stage -- --primitive none 生成的骨架可以照抄），或改用原语：stage.config.js 写 primitive: 'vote' 等`, 'self-stage');
        }
      }
      const layout = cfg.layout ?? 'focus';
      const layoutOk = LAYOUTS.includes(layout);
      if (!layoutOk) {
        error(e.file, findLine(e.src, /^\s*layout\s*:/m), `layout '${layout}' 不是五种页面样式之一`,
          `layout 改成 ${LAYOUTS.map((l) => `'${l}'`).join(' / ')} 之一`, 'layout');
      }
      // 学生视图与 layout 比（layout 非法时跳过，免得建议改成非法值）；演示视图与它的缺省 focus 比（契约 §四）
      const studentSrc = layoutOk && has('Student.jsx') ? readText(at('Student.jsx')) : null;
      for (const p of studentSrc === null ? [] : pageTemplates(studentSrc)) {
        if (p.dynamic) {
          warn(at('Student.jsx'), p.line, `<Page template> 不是字面量，没法确认与 layout '${layout}' 一致`,
            `直接写 <Page template="${layout}">，或不写 template（学生视图取 stage.config.js 的 layout）`, 'page-template');
        } else if (p.template !== undefined && p.template !== layout) {
          error(at('Student.jsx'), p.line, `Student.jsx 的 <Page template="${p.template}"> 与 stage.config.js 的 layout '${layout}' 不一致`,
            `在 stage.config.js 里把 layout 改成 '${p.template}'，或把 Student.jsx 的 <Page template> 改成 '${layout}'`, 'page-template');
        }
      }
      const demoSrc = has('TeacherDemo.jsx') ? readText(at('TeacherDemo.jsx')) : null;
      for (const p of demoSrc === null ? [] : pageTemplates(demoSrc)) {
        if (!p.dynamic && p.template !== undefined && p.template !== 'focus' && LAYOUTS.includes(p.template)) {
          warn(at('TeacherDemo.jsx'), p.line, `TeacherDemo.jsx 的 <Page template="${p.template}"> 不是演示视图的缺省 focus，确认是有意为之`,
            "有意用别的样式就保留；否则改成 <Page template=\"focus\">，或不写 template（演示视图缺省 focus）", 'page-template');
        } else if (!p.dynamic && p.template !== undefined && !LAYOUTS.includes(p.template)) {
          error(at('TeacherDemo.jsx'), p.line, `TeacherDemo.jsx 的 <Page template="${p.template}"> 不是五种页面样式之一`,
            `template 改成 ${LAYOUTS.map((l) => `'${l}'`).join(' / ')} 之一（演示视图一般用 'focus'）`, 'page-template');
        }
      }
      const serverSrc = has('server.js') ? readText(at('server.js')) : null;
      if (serverSrc !== null) {
        const srv = serverEvents(serverSrc, await moduleFacts(serverSrc));
        const clientFiles = noTests.filter((f) => f.endsWith('.jsx') || path.posix.basename(f) === 'store.js')
          .map((f) => ({ abs: at(f), src: readText(at(f)) ?? '' }));
        const cli = clientEvents(clientFiles);
        for (const s of cli.sends) {
          if (srv.registered.has(s.event)) continue;
          const text = `客户端发送了 ${s.event}，server.js 里没有找到 ctx.on('${s.event}', …) 注册`;
          const fix = `在 server.js 的 register(ctx) 里加 ctx.on('${s.event}', shape({…}), handler)，或改成已注册的事件名`;
          if (srv.uncertain) warn(s.file, s.line, `${text}（${srv.uncertain}，无法静态确认，请自行核对）`, fix, 'events');
          else error(s.file, s.line, text, fix, 'events');
        }
        for (const [ev, line] of srv.registered) {
          if (cli.mentioned.has(ev)) continue;
          warn(at('server.js'), line, `server.js 注册了 ${ev}，但视图里从没发过它${cli.dynamic ? '（视图里有非字面量的事件名，可能是误报）' : ''}`,
            `在 Student.jsx（或教师视图）里用 send('${ev}', …) 发送，用不上就删掉这个 ctx.on`, 'events');
        }
      }
      // 9 模拟片段
      if (!has('__tests__/simulate.js')) {
        warn(at('__tests__/simulate.js'), null, '自写阶段缺模拟片段 __tests__/simulate.js（npm run simulate / load 要用）',
          `照${CONTRACT} §七写 export async function play({ students }) 与 export function loadAction({ student })`, 'simulate');
      }
    }

    // 6 组件引用
    for (const f of noTests.filter((x) => /\.(jsx?|mjs)$/.test(x))) {
      const src = readText(at(f)) ?? '';
      const code = stripComments(src);
      for (const m of code.matchAll(/[@#]components\/([a-z][a-z0-9-]*)/g)) {
        if (openComponents.includes(m[1])) continue;
        error(at(f), lineAt(code, m.index), `引用了组件 ${m[1]}，但 lesson.config.js 的 components 里没有打开它`,
          `在 lesson.config.js 的 components 里加上 '${m[1]}'，或删掉这个引用`, 'components');
      }
    }

    // 7 保密选项
    if (loadedStage && loadedStage.secretOptions?.length && isPlainObject(loadedStage.config.options)) {
      const secrets = [];
      for (const key of loadedStage.secretOptions) for (const s of secretStrings(loadedStage.config.options[key])) secrets.push({ key, s });
      for (const f of noTests.filter((x) => x.endsWith('.jsx') || x === 'STAGE.md')) {
        const src = readText(at(f)) ?? '';
        for (const { key, s } of secrets) {
          const idx = src.indexOf(s);
          if (idx === -1) continue;
          const shown = s.length > 24 ? `${s.slice(0, 24)}…` : s;
          error(at(f), lineAt(src, idx), `保密选项 ${key} 的内容"${shown.replace(/\s+/g, ' ')}"出现在 ${path.posix.basename(f)} 里：答案不能写进视图或阶段卡`,
            `从 ${path.posix.basename(f)} 删掉这段文字；答案只写在 stage.config.js 的 options 里（学生收到的课堂状态里会去掉它）`, 'secret');
        }
      }
    }

    // 8 UI 规则（check-ui 同一套扫描）
    for (const f of noTests.filter((x) => x.endsWith('.jsx'))) {
      const src = readText(at(f)) ?? '';
      for (const h of scanSource(src, `stages/${dir}/${f}`)) {
        error(at(f), h.line, `界面规则：${h.message}`, UI_FIXES[h.rule] ?? `对照${CONTRACT} §四"页面与布局"修改`, `ui:${h.rule}`);
      }
    }

    // TODO 占位
    for (const f of files.filter((x) => TEXT_EXT.test(x))) todoCheck(at(f), readText(at(f)), warn);
  }

  return { ok: errors.length === 0, errors, warnings, lesson };
}

function todoCheck(file, src, warn) {
  if (!src) return;
  const hits = [...src.matchAll(/\bTODO\b/g)];
  if (hits.length === 0) return;
  warn(file, lineAt(src, hits[0].index), `还有 ${hits.length} 处 TODO 占位`, '把 TODO 换成本课的内容（照 STAGE.md 阶段卡填写）', 'todo');
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  } catch {
    return [];
  }
}

// ===== 输出 =====
export function formatItem(it) {
  const where = it.file ? `${it.file}${it.line ? `:${it.line}` : ''}` : '（课程）';
  return `${it.level === 'error' ? '错误' : '警告'}  ${where}  ${it.message}${it.fix ? `  → ${it.fix}` : ''}`;
}

export function summaryLine(r) {
  const n = r.errors.length;
  const m = r.warnings.length;
  if (n > 0) return `${n} 处错误 ${m} 处警告`;
  return m > 0 ? `通过，${m} 处警告` : '通过';
}

export function formatReport(r) {
  return [...r.errors, ...r.warnings].map(formatItem).concat(summaryLine(r)).join('\n');
}

function envLessonConfig(cwd) {
  try {
    return dotenv.parse(fs.readFileSync(path.join(cwd, '.env'), 'utf8')).LESSON_CONFIG || null;
  } catch {
    return null;
  }
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = (l) => console.log(l) } = {}) {
  const json = argv.includes('--json');
  const target = argv.find((a) => !a.startsWith('--')) ?? envLessonConfig(cwd) ?? './lesson.config.js';
  const r = await checkLesson(target, { root: cwd });
  log(json ? JSON.stringify(r, null, 2) : `check:lesson ${toPosix(target)}\n${formatReport(r)}`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.log(`check:lesson 没能完成：${clean(err?.message ?? err)}`);
    process.exitCode = 1;
  });
}
export const CHECK_LESSON_FILE = fileURLToPath(import.meta.url);
