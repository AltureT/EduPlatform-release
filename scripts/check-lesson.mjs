#!/usr/bin/env node
// npm run check:lesson（L1，契约 §七"校验器"）：课程校验器。AI 生成或改完课程后跑一次，指到 文件:行 并给出怎么改。
//   node scripts/check-lesson.mjs [lesson.config 路径] [--json] [--no-cache]
//     路径缺省读 .env 的 LESSON_CONFIG，再缺省 ./lesson.config.js；有错误退出 1；--json 输出 { ok, errors, warnings, lesson, tests, infos }
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
//      D1（学生输入自动保存规格 §2.4）：自写段 Student.jsx 有输入框却没用 useDraft → 警告 draft-missing
//   9 模拟片段：自写阶段缺 __tests__/simulate.js → 警告
//   10 AI 助手（coach 组件规格 §2）：stage.config.js 顶层 coach 只能是 boolean 或 { intro: ≤ 60 字 }（否则错误）；
//     写了 coach 为真而 lesson.config.components 没有 'coach' → 警告
//   11 AI 接口（统一 AI 接口规格 §5，契约 §三"调 AI"）：lesson.config.js 与阶段目录的 .js / .jsx / .mjs（不含 __tests__）逐行查——
//     出现 chat/completions、AI_BASE_URL / AI_API_KEY / AI_MODEL、process.env.AI、process.env.<任意>_(API_)KEY、Authorization 与 Bearer（同一文件）、sk- 密钥串、
//     路径含 /v1 的 http(s) 地址 → 错误；客户端文件（.jsx，含 Student / TeacherDemo / TeacherStats / client.jsx）出现 ctx.ai / cctx.ai / ctx['ai'] → 错误；
//     客户端文件 fetch('http…') 字面量直连外网 → 警告（/api/ 相对路径不算）
//   12 平台文件（框架自描述规格 §4）：平台目录有 版本.json 且带 protected 时逐文件比对 sha256；改动 / 缺失 / 受保护目录下多出 → 一条警告
//     "平台文件被改过：<第一个> 等 N 个（改动 a 个、缺失 b 个、多出 c 个）"（不挡启动）；没有 版本.json（开发仓库）跳过。
//     平台目录缺省 = 本脚本所在的平台目录（platformRoot 可注入）；比对逻辑在 scripts/lib/platform-files.js
//   13 课程组件（课程本地组件规格 §5）：lesson.config.js 所在目录的 components/<cid>/ 逐个查（错误）——
//     component.config.js 默认导出 { id, label } 且 id 与目录名一致；id 合法、不是保留字 / 内置组件名、不与平台组件重名；
//     server.js 有则导出 register，cctx.on('…') 的事件前缀必须是自己的 id；client.jsx 有则过 check:ui、slots 只用契约槽位名；
//     代码文件过第 11 项；README.md 缺失 → 警告；没在 lesson.config.js 的 components 里打开 → 警告。
//     阶段顶层写已启用组件的 id（如 gallery: true）不报；第 6 项同样认 @lesson-components/<id>
//   14 代码题测试（代码题测试验证规格 §4）：有 sandbox.tests 的段用参考答案（code 段 options.solution、自写段阶段目录 solution.py）
//     跑 pytest、做变异检验（scripts/lib/pyrun-node.js，Pyodide 只起一次）；只出警告与信息，不出错误；结果缓存在 data/check-cache.json，--no-cache 重跑
//     V2（代码题批改规格 §3.3、§4.2、§5）：本段目录有 hidden.json / mistakes/ / brute.py 时另查——隐藏用例没生成、过期、没列进 tests、形状错；
//     某条用参考答案算不出（tests-hidden-error，审查 2）；错误库 mistakes.json 没生成或过期、某版本没被抓住、两个版本失败用例一样；笨办法解没通过测试。都是警告；
//     tests[].extra = { hidden: 列入 tests 的隐藏用例条数, mistakes: 错误版本个数 }（有且 > 0 才有该键）；这些重算走同一个运行器、计入每段预算
//   另：TODO 占位（new:stage 的骨架）每个文件一条警告
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { loadLesson, DEFAULT_PRIMITIVES_ROOT } from '../kernel/server/stage-loader.js';
import {
  componentIdsOf, loadComponents, lessonComponentsRootOf, COMPONENT_ID_RE, RESERVED_COMPONENT_IDS, BUILTIN_COMPONENT_IDS,
} from '../kernel/server/component-loader.js';
import stripStageOptions from '../kernel/build/strip-stage-options.js';
import { scanSource, draftWarnings } from './check-ui.mjs';
import { STAGE_CARD_COLUMNS, parseStageCard } from './lib/stage-card.js';
import {
  isPlainObject, toPosix, lineAt, findLine, stripComments, walkFiles, loadParseAst, syntaxErrorAt, moduleFacts,
} from './lib/lesson-source.js';
import { checkPlatformFiles, platformFilesWarning } from './lib/platform-files.js';
import { createPyRunner, PYRUN_VERSION } from './lib/pyrun-node.js';
import {
  HIDDEN_JSON, HIDDEN_FILE, HIDDEN_PATH, MISTAKES_DIR, MISTAKES_JSON, BRUTE_FILE, MISTAKES_MAX, EVAL_TIMEOUT_MS,
  parseHidden, renderHiddenTests, hiddenCount, parseMistakeFile, renderMistakesJson, mistakeIssues, computeHidden, computeMistakes, listedLine,
} from './lib/hidden-tests.js';

export const LAYOUTS = ['focus', 'split', 'tiles', 'table', 'stack'];
const VIEW_FILES = ['Student.jsx', 'TeacherDemo.jsx', 'TeacherStats.jsx'];
const SECRET_MIN = 8;
// 审查 5：事件名后半段放宽（内核只要求 student: / teacher: 前缀，不限字符）
const EVENT = '(?:student|teacher):[a-z0-9_:-]+';
const COMPONENTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
export const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_EXT = /\.(js|jsx|mjs|md|py|csv|txt|json)$/;
const CONTRACT = '契约 docs/02-阶段模块契约.md';

// 11 AI 接口：课程代码里不许出现的东西（每行报第一处；密钥本身不回显）
export const AI_CODE_RULES = [
  { re: /chat\/completions/, label: () => 'chat/completions' },
  { re: /\bAI_(?:BASE_URL|API_KEY|MODEL)(?:_2)?\b/, label: (m) => m[0] },   // K8：含备用接口的 _2
  { re: /process\.env\.AI/, label: () => 'process.env.AI…' },
  { re: /process\.env(?:\.|\?\.|\s*\[\s*['"`])[A-Za-z0-9_]*_(?:API_)?KEY\b/, label: () => 'process.env.…_KEY' },
  { re: /\bsk-[A-Za-z0-9]{16,}/, label: () => '密钥串 sk-…' },
  { re: /https?:\/\/[^\s'"`<>()]*\/v1/, label: () => '模型接口地址（…/v1）' },
];
export const AI_BEARER = { auth: /\bauthorization\b/i, bearer: /\bBearer\b/ };
export const AI_IN_CLIENT = /\bc?ctx\s*(?:\??\.\s*ai\b|(?:\?\.)?\[\s*(['"`])ai\1\s*\])/;
export const CLIENT_FETCH_HTTP = /\bfetch\s*\(\s*(['"`])https?:\/\//;
const AI_FIX = "服务端用 ctx.ai.chat（契约 §三\"调 AI\"），地址、模型、密钥只在管理台第 4 步'上课准备'填，课程代码里不写";
// 13 课程组件：契约 §八的槽位名（与 kernel/client/stores/componentRegistry.js 的 SLOT_NAMES 一致，测试核对）
export const CONTRACT_SLOTS = [
  'teacherToolbar', 'teacherMain', 'teacherSidebar', 'teacherOverlay', 'teacherCurtain',
  'studentOverlay', 'studentCurtain', 'studentBanner', 'studentAside',
];
const COMPONENT_DOC = 'docs/06-组件契约.md';

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
  // 名单与数据以课程为主体规格 §2.1：课程 id 必填且合法（决定这门课的库 data/lessons/<id>.sqlite）
  [/lesson\.config\.js 缺少 id|lesson\.config\.js 的 id .* 不对/, () => "在 lesson.config.js 写 id，小写字母开头、只含小写字母、数字和连字符，如 id: 'prime-intro'；id 决定这门课的数据存在哪，改了算一门新课"],
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
  [/component "([^"]+)": unknown component/, (m) => `把 '${m[1]}' 从 lesson.config.js 的 components 里删掉或改成已有的组件（${componentChoices()}）；要给这节课单独做一个就在课程目录的 components/${m[1]}/ 下建（npm run new:component）`],
  [/与平台组件重名|平台内置组件的名字/, () => '课程组件换一个名字（建议 x- 开头）：目录名、component.config.js 的 id 与 lesson.config.js 的 components 里一起改'],
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
  // K5：shape() 的缺键消息为"缺少字段 <键>"；旧英文"<键>: required"仍认（原语自己的校验函数可能照旧）
  const req = /缺少字段 ([A-Za-z_$][\w$]*(?:\[\d+\])?(?:\.[A-Za-z_$][\w$]*)*)/.exec(msg)
    ?? /(?:^|[：\s])([A-Za-z_$][\w$]*(?:\[\d+\])?(?:\.[A-Za-z_$][\w$]*)*): required\b/.exec(msg);
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

// 平台里其它 id 相同的课：根目录 lesson.config.js、examples/*、lessons/*（读不出来的跳过；按真实路径排除自己）
async function lessonsWithSameId(root, absConfig, id) {
  const real = (f) => {
    try {
      return fs.realpathSync(f);
    } catch {
      return path.resolve(f);
    }
  };
  const self = real(absConfig);
  const files = [path.join(root, 'lesson.config.js')];
  for (const scope of ['examples', 'lessons']) {
    try {
      for (const d of fs.readdirSync(path.join(root, scope), { withFileTypes: true })) {
        if (d.isDirectory()) files.push(path.join(root, scope, d.name, 'lesson.config.js'));
      }
    } catch {
      // 没有这个目录
    }
  }
  const out = [];
  for (const f of files) {
    if (!fs.existsSync(f) || real(f) === self) continue;
    try {
      const cfg = (await import(pathToFileURL(f).href)).default;
      if (isPlainObject(cfg) && cfg.id === id) out.push(f);
    } catch {
      // 读不出来的课由它自己的检查报
    }
  }
  return out;
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
  root = process.cwd(), primitivesRoot = DEFAULT_PRIMITIVES_ROOT, componentsRoot = COMPONENTS_ROOT, platformRoot = PLATFORM_ROOT,
  pyRunner, noCache = false, cacheFile, testsBudgetMs,
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
  // C5：课程组件目录 = lesson.config.js 所在目录的 components/；就是平台自己的 components/（课程配置放在平台根上）时没有课程组件
  const lessonComponentsRoot = [componentsRoot, path.join(platformRoot, 'components')]
    .some((d) => path.resolve(d) === lessonComponentsRootOf(absConfig)) ? null : lessonComponentsRootOf(absConfig);
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

  // 名单与数据以课程为主体规格 §2.1：同一平台里两门课 id 相同 → 会共用一个库（名单、课堂数据、备份）
  if (isPlainObject(lessonConfig) && typeof lessonConfig.id === 'string' && lessonConfig.id) {
    for (const other of await lessonsWithSameId(root, absConfig, lessonConfig.id)) {
      warn(absConfig, findLine(lessonSrc, /^\s*id\s*:/m),
        `这门课（${rel(absConfig)}）与 ${rel(other)} 的 id 都是 "${lessonConfig.id}"，两门课会共用同一份名单和课堂数据`,
        '把其中一门课 lesson.config.js 的 id 改成别的（小写字母、数字、连字符）；改了 id 算一门新课', 'lesson-id');
    }
  }

  // 13 课程组件（静态检查；先于加载器，已报过错的组件不再重复报加载器的英文错误）
  const openIds = isPlainObject(lessonConfig) ? componentIdsOf(lessonConfig) : [];
  const badLessonComponents = lessonComponentsRoot
    ? await checkLessonComponents({ root: lessonComponentsRoot, componentsRoot, openIds, error, warn })
    : new Set();

  // 审查 1：课程级组件（内核加载器只取 id，组件本身由 component-loader 在启动时加载）
  if (isPlainObject(lessonConfig)) {
    try {
      await loadComponents(lessonConfig, componentsRoot, { lessonComponentsRoot });
    } catch (err) {
      const msg = String(err?.message ?? err).replace(`${componentsRoot}${path.sep}`, 'components/')
        .replace(`${path.dirname(absConfig)}${path.sep}`, `${rel(path.dirname(absConfig))}/`);
      const id = /component "([^"]+)"/.exec(msg)?.[1];
      const line = (id ? findLine(lessonSrc, new RegExp(`['"\`]${esc(id)}['"\`]`)) : null) ?? findLine(lessonSrc, /^\s*components\s*:/m);
      if (!(id && badLessonComponents.has(id))) error(absConfig, line, msg, loaderFix(msg, null), 'components');
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
  // 11 AI 接口：lesson.config.js
  if (lessonSrc !== null) aiCheck(absConfig, lessonSrc, { client: false }, error, warn);

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

    // coach（AI 助手，coach 组件规格 §2）：顶层 coach 为 boolean 或 { intro: ≤ 60 字 }；写了真值而课程没开组件 → 警告
    if (cfg && cfg.coach !== undefined) {
      const line = findLine(e.src, /^\s*['"]?coach['"]?\s*:/m);
      if (!coachFieldOk(cfg.coach)) {
        error(e.file, line, `coach 写成了 ${JSON.stringify(cfg.coach) ?? String(cfg.coach)}，只能是 true / false 或 { intro: '…' }（intro 不超过 ${COACH_INTRO_MAX} 字）`,
          `改成 coach: true，或 coach: { intro: '卡住了？可以问 AI 要个提示' }（横幅区那一行的话，≤ ${COACH_INTRO_MAX} 字）；不要 AI 助手就删掉这一行`, 'coach');
      } else if (cfg.coach !== false && !openComponents.includes('coach')) {
        warn(e.file, line, `段 ${cfg.id ?? dir} 写了 coach，但课程没开 AI 助手`,
          "lesson.config.js 的 components 加 'coach'", 'coach');
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
      for (const m of code.matchAll(/(?:[@#]|@lesson-)components\/([a-z][a-z0-9-]*)/g)) {
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

    // 11 AI 接口：阶段目录的代码文件（不含 __tests__）
    for (const f of noTests.filter((x) => /\.(jsx?|mjs)$/.test(x))) {
      aiCheck(at(f), readText(at(f)) ?? '', { client: f.endsWith('.jsx') }, error, warn);
    }

    // 8 UI 规则（check-ui 同一套扫描）
    for (const f of noTests.filter((x) => x.endsWith('.jsx'))) {
      const src = readText(at(f)) ?? '';
      for (const h of scanSource(src, `stages/${dir}/${f}`)) {
        error(at(f), h.line, `界面规则：${h.message}`, UI_FIXES[h.rule] ?? `对照${CONTRACT} §四"页面与布局"修改`, `ui:${h.rule}`);
      }
      // D1：学生输入要自动保存（只出警告）
      for (const h of draftWarnings(src, `stages/${dir}/${f}`)) {
        warn(at(f), h.line, '学生页有输入框，但输入的内容刷新后会丢',
          `学生输入改用 useDraft（${CONTRACT} §四"学生输入自动保存"），照 examples/minimal/stages/02-freeform/Student.jsx 写`, 'draft-missing');
      }
    }

    // TODO 占位
    for (const f of files.filter((x) => TEXT_EXT.test(x))) todoCheck(at(f), readText(at(f)), warn);
  }

  // 12 平台文件改动（警告，不挡启动）
  const pf = platformFilesWarning(checkPlatformFiles(platformRoot));
  if (pf) warn(path.join(platformRoot, pf.first), null, pf.message, pf.fix, 'platform-files');

  // 14 代码题测试（只出警告与信息，不出错误）
  const infos = [];
  const tests = await checkCodeTests({
    stageDirs, stagesRoot, raw, loaded, byDir, absConfig, platformRoot, warn, infos, rel,
    pyRunner, noCache, cacheFile: cacheFile ?? path.join(platformRoot, 'data', 'check-cache.json'), budgetMs: testsBudgetMs,
  });

  return { ok: errors.length === 0, errors, warnings, lesson, tests, infos };
}

// ===== 14 代码题测试（代码题测试验证规格 §4）=====
// 有 tests 的段：参考答案跑测试、变异检验；结果按 sha256(答案 + 测试 + 运行器版本) 缓存在 data/check-cache.json
export const TEST_TIMEOUT_MS = 20_000;
export const TEST_BUDGET_MS = 180_000;
export const MUTANTS_MAX = 20;
export const MUTANTS_MIN_JUDGE = 5;
export const KILL_RATE_MIN = 0.6;
export const CASES_MIN = 3;
const CACHE_MAX = 200;
const WRITE_TESTS = 'skills/参考/写测试.md';

const countCases = (tests) => Object.values(tests).reduce((n, src) => n + (String(src).match(/^\s*(?:async\s+)?def\s+test_/gm) ?? []).length, 0);
const firstLine = (s, max = 80) => {
  const l = String(s ?? '').split('\n')[0].trim();
  return l.length > max ? `${l.slice(0, max - 1)}…` : l;
};
const allPass = (r) => !r.timedOut && r.total > 0 && r.passed === r.total && r.failed === 0 && r.errors === 0;

function readCache(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlainObject(c) ? c : {};
  } catch {
    return {};
  }
}

// 原子写：先写 .tmp 再 rename（管理台检查 worker 超时被结束时不会留下半截文件）
function writeCache(file, cache) {
  if (!fs.existsSync(path.dirname(file))) return; // data/ 不在：不写也不报错
  const keys = Object.keys(cache).sort((a, b) => (Number(cache[a]?.at) || 0) - (Number(cache[b]?.at) || 0));
  for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete cache[k];
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(cache)}\n`);
    fs.renameSync(tmp, file);
  } catch {
    // 写不进也不影响检查结果
    try { fs.rmSync(tmp, { force: true }); } catch { /* 忽略 */ }
  }
}

// 只有注释 / 空白的参考答案（如 new:stage 骨架的 # TODO 一行）当作没有答案
const hasCode = (src) => typeof src === 'string' && src.split('\n').some((l) => l.trim() !== '' && !l.trim().startsWith('#'));
// 测试用 runpy 跑 __main__（输入输出题）时，__main__ 块里的变体也要生成
const RUNS_MAIN = /\brun_path\b|run_name\s*=\s*['"]__main__['"]/;

// V2：参考答案通过后、变异检验之前跑"隐藏用例重算 / 错误库重算 / 对拍"（代码题批改规格 §3.3、§4.2、§5）
//   ex = { hidden: cases | null, mistakes: [{ id, label, hint, code }] | { error } | null, brute: 文本 | null }
//   → { hidden: { rendered } | null, mistakes: { json, uncaught, same, labels } | { error } | null, brute: { failing } | null, incomplete }
async function runExtras(runner, solution, tests, files, ex, left) {
  const out = { hidden: null, mistakes: null, brute: null, incomplete: false };
  const lim = (ms) => ({ timeoutMs: Math.max(1, Math.min(ms, left())), initTimeoutMs: Math.max(1, left()) });
  const over = () => {
    if (left() > 0) return false;
    out.incomplete = true;
    return true;
  };
  if (ex.hidden && !over()) {
    const res = await computeHidden(runner, solution, ex.hidden, { files, ...lim(EVAL_TIMEOUT_MS) });
    if (res.some((r) => r.timedOut) && left() <= 0) out.incomplete = true;
    else {
      // 审查 2：有条目用参考答案算不出 → 不拿"缺这条"的渲染结果去比对，改报 tests-hidden-error
      const errors = res.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error }));
      out.hidden = errors.length > 0 ? { errors } : { rendered: renderHiddenTests(ex.hidden, res.map((r) => r.hash)) };
    }
  }
  if (ex.mistakes && !over()) {
    if (!Array.isArray(ex.mistakes)) out.mistakes = { error: ex.mistakes.error };
    else {
      try {
        const m = await computeMistakes(runner, { solution, tests, files, mistakes: ex.mistakes, ...lim(TEST_TIMEOUT_MS) });
        if (left() <= 0) out.incomplete = true;
        else {
          const { uncaught, same } = mistakeIssues(m.mistakes);
          out.mistakes = { json: renderMistakesJson(m), uncaught, same, labels: Object.fromEntries(m.mistakes.map((y) => [y.id, y.label])) };
        }
      } catch (err) {
        if (left() <= 0) out.incomplete = true;
        else out.mistakes = { error: firstLine(err?.message ?? err) };
      }
    }
  }
  if (typeof ex.brute === 'string' && !over()) {
    const r = await runner.runTests(ex.brute, tests, { files, ...lim(TEST_TIMEOUT_MS) });
    if (r.timedOut && left() <= 0) out.incomplete = true;
    else if (r.timedOut) out.brute = { failing: ['（超时）'] };
    else if (allPass(r)) out.brute = { failing: [] };
    else {
      const bad = r.cases.filter((c) => !c.ok).map((c) => c.name);
      out.brute = { failing: bad.length > 0 ? bad : ['（测试没能运行）'] };
    }
  }
  return out;
}

// 跑一段：参考答案 →（V2）隐藏用例 / 错误库 / 对拍 → 变异检验；返回可缓存的测量结果 { solution, run, mutants, extras, ms, incomplete }
async function measureStage(runner, solution, tests, files, budgetMs, ex = {}) {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  // 每次调用都带预算：要（重）建 worker 时初始化超时取 min(60 秒, 剩余预算)
  const opts = (timeoutMs) => ({ files, timeoutMs: Math.max(1, Math.min(timeoutMs, left())), initTimeoutMs: Math.max(1, left()) });
  const timedOutEarly = () => ({ solution: 'timeout', run: null, mutants: null, ms: Date.now() - t0, incomplete: true });
  try {
    await runner.reset?.({ initTimeoutMs: Math.max(1, left()) }); // 每段开始前清空 /work
  } catch (err) {
    if (err?.timedOut) return timedOutEarly();
    throw err;
  }
  const run = await runner.runTests(solution, tests, opts(TEST_TIMEOUT_MS));
  // 预算用完（多半是 Python 起动太慢）→ 没跑完；否则是参考答案自己超时
  if (run.timedOut) return left() <= 0 ? timedOutEarly() : { solution: 'timeout', run: null, mutants: null, ms: Date.now() - t0, incomplete: false };
  if (!allPass(run)) {
    const bad = run.cases.filter((c) => !c.ok);
    return { solution: 'fail', run: { cases: bad.slice(0, 3), more: bad.length > 3 }, mutants: null, ms: Date.now() - t0, incomplete: false };
  }
  const extras = (ex.hidden || ex.mistakes || typeof ex.brute === 'string') ? await runExtras(runner, solution, tests, files, ex, left) : null;
  if (extras?.incomplete) return { solution: 'pass', run: null, mutants: { total: 0, killed: 0, survived: [] }, extras, ms: Date.now() - t0, incomplete: true };
  // 变体单次超时：参考答案耗时的 5 倍、至少 3 秒、至多 20 秒（改坏的循环常常死循环，不必每个都等满 20 秒）
  const mutantTimeout = Math.min(TEST_TIMEOUT_MS, Math.max(3000, (run.ms ?? 0) * 5));
  let list;
  try {
    list = await runner.mutants(solution, { max: MUTANTS_MAX, includeMain: RUNS_MAIN.test(Object.values(tests).join('\n')), initTimeoutMs: Math.max(1, left()) });
  } catch (err) {
    if (!err?.timedOut) throw err;
    return { solution: 'pass', run: null, mutants: { total: 0, killed: 0, survived: [] }, extras, ms: Date.now() - t0, incomplete: true };
  }
  let killed = 0;
  let total = 0;
  const survived = [];
  let incomplete = false;
  for (const m of list) {
    if (left() <= 0) {
      incomplete = true;
      break;
    }
    const r = await runner.runTests(m.code, tests, opts(mutantTimeout));
    // 预算耗尽导致的超时不算"抓住"，算没跑完
    if (r.timedOut && left() <= 0) {
      incomplete = true;
      break;
    }
    total += 1;
    if (allPass(r)) survived.push({ line: m.line, desc: m.desc });
    else killed += 1;
  }
  return { solution: 'pass', run: null, mutants: { total, killed, survived }, extras, ms: Date.now() - t0, incomplete };
}

// V2：本段目录里的隐藏用例 / 错误库 / 笨办法解（读文件，不跑）
function readExtras(stageDir) {
  const x = {
    hiddenText: readText(path.join(stageDir, HIDDEN_JSON)), hidden: null, hiddenError: null, hiddenFile: readText(path.join(stageDir, HIDDEN_PATH)),
    mistakeFiles: [], mistakes: null, mistakesJson: readText(path.join(stageDir, MISTAKES_JSON)), bruteText: readText(path.join(stageDir, BRUTE_FILE)),
  };
  if (x.hiddenText != null) {
    try {
      x.hidden = parseHidden(x.hiddenText);
    } catch (err) {
      x.hiddenError = err.message;
    }
  }
  const mdir = path.join(stageDir, MISTAKES_DIR);
  let names = [];
  try {
    names = fs.readdirSync(mdir).filter((f) => f.endsWith('.py')).sort();
  } catch {
    names = [];
  }
  x.mistakeFiles = names.map((f) => ({ file: f, text: readText(path.join(mdir, f)) ?? '' }));
  if (names.length > MISTAKES_MAX) x.mistakes = { error: `${MISTAKES_DIR}/ 最多 ${MISTAKES_MAX} 个错误版本，现在 ${names.length} 个` };
  else if (names.length > 0) {
    try {
      x.mistakes = x.mistakeFiles.map((f) => parseMistakeFile(f.file, f.text));
    } catch (err) {
      x.mistakes = { error: err.message };
    }
  }
  return x;
}

async function checkCodeTests({
  stageDirs, stagesRoot, raw, loaded, byDir, absConfig, platformRoot, warn, infos, rel, pyRunner, noCache, cacheFile, budgetMs = TEST_BUDGET_MS,
}) {
  const out = [];
  const cache = noCache ? {} : readCache(cacheFile);
  const lessonKey = (() => {
    const r = toPosix(path.relative(platformRoot, absConfig));
    return r && !r.startsWith('..') ? r : toPosix(absConfig);
  })();
  // 缓存只记平台目录里的课（临时目录里的课不写进平台的 data/check-cache.json）
  const cacheable = !lessonKey.startsWith('/') && !/^[A-Za-z]:/.test(lessonKey);
  let runner = null;
  const getRunner = () => {
    if (!runner) runner = (pyRunner ?? ((o) => createPyRunner(o)))({ root: platformRoot });
    return runner;
  };
  try {
    let n = 0;
    for (const dir of stageDirs) {
      n += 1;
      const stage = (loaded ? loaded.stages.find((s) => path.basename(s.dir) === dir) : null) ?? byDir.get(dir) ?? null;
      const tests = stage?.config?.sandbox?.tests;
      if (!isPlainObject(tests) || Object.keys(tests).length === 0) continue;
      // 数据文件（有效 sandbox 配置的 files，与学生端同一份）：参考答案与变体都要读得到
      const files = isPlainObject(stage.config.sandbox.files) ? stage.config.sandbox.files : {};
      const id = stage.config.id ?? dir;
      const where = `第 ${n} 段（${id}）`;
      const e = raw.get(dir);
      const cfgFile = e?.file ?? path.join(stagesRoot, dir, 'stage.config.js');
      const testsLine = findLine(e?.src, /^\s*['"]?tests['"]?\s*:/m);
      const isPrimitive = stage.config.primitive != null;
      const solutionFile = path.join(stagesRoot, dir, 'solution.py');
      const solution = isPrimitive
        ? (stage.serverOptions?.solution ?? stage.config.options?.solution)
        : readText(solutionFile);
      const cases = countCases(tests);
      const entry = { stage: id, dir, cases, solution: 'missing', mutants: null, ms: 0, cached: false, extra: {} };
      out.push(entry);
      let warned = false;
      const w = (...a) => {
        warned = true;
        warn(...a);
      };

      // V2 静态部分（不起 Python）：隐藏用例形状 / 没生成 / 没列进 tests；extra 条数
      const stageDir = path.join(stagesRoot, dir);
      const x = readExtras(stageDir);
      const prepCmd = `npm run prep:tests -- ${rel(stageDir)}`;
      const listed = Object.hasOwn(tests, HIDDEN_FILE);
      if (x.hiddenError) {
        w(path.join(stageDir, HIDDEN_JSON), null, `${where}的隐藏用例 hidden.json 写得不对：${x.hiddenError}`,
          `照 ${WRITE_TESTS} §6 改，再跑 ${prepCmd}`, 'tests-hidden-shape');
      } else if (x.hidden && x.hiddenFile == null) {
        w(path.join(stageDir, HIDDEN_JSON), null, `${where}隐藏用例还没生成`, prepCmd, 'tests-hidden-missing');
      }
      if (x.hiddenFile != null && !listed) {
        w(cfgFile, testsLine, `${where}的 ${HIDDEN_PATH} 没列进测试，学生跑不到隐藏用例`, `在测试里加：${listedLine(isPrimitive)}`, 'tests-hidden-unlisted');
      }
      if (listed && hiddenCount(tests[HIDDEN_FILE]) > 0) entry.extra.hidden = hiddenCount(tests[HIDDEN_FILE]);
      if (x.mistakeFiles.length > 0) entry.extra.mistakes = x.mistakeFiles.length;

      // 1 有测试没答案
      if (!hasCode(solution)) {
        warn(cfgFile, testsLine, `${where}有测试但没有参考答案，测试没验证`,
          isPrimitive
            ? "在 options 里写 solution: { from: './solution.py' }（参考答案，只发教师），再跑一次 check:lesson"
            : '在本段目录放 solution.py（参考答案，不进学生页面），再跑一次 check:lesson', 'tests-no-solution');
        continue;
      }
      // 2 用例太少（继续）
      if (cases < CASES_MIN) {
        w(cfgFile, testsLine, `${where}只有 ${cases} 个测试用例`, `正常、边界、反例各至少一条（${WRITE_TESTS}）`, 'tests-too-few');
      }
      const solFile = isPrimitive ? cfgFile : solutionFile;
      const solLine = isPrimitive ? findLine(e?.src, /^\s*['"]?solution['"]?\s*:/m) : null;

      // 缓存
      const names = Object.keys(tests).sort();
      const fileNames = Object.keys(files).sort();
      const hash = crypto.createHash('sha256')
        .update(JSON.stringify([solution, names.map((k) => [k, tests[k]]), fileNames.map((k) => [k, files[k]]), PYRUN_VERSION,
          // V2：隐藏用例定义、错误版本、笨办法解（生成物 test_hidden.py / mistakes.json 每次现比，不进哈希）
          x.hiddenText, x.mistakeFiles.map((f) => [f.file, f.text]), x.bruteText]))
        .digest('hex');
      const key = `${lessonKey}::${id}`;
      let m = null;
      const hit = cache[key];
      if (!noCache && hit?.hash === hash && isPlainObject(hit.result)) {
        m = hit.result;
        entry.cached = true;
      } else {
        const r = getRunner();
        if (r.available) {
          try {
            m = await measureStage(r, solution, tests, files, budgetMs, {
              hidden: x.hidden && (x.hiddenFile != null || listed) ? x.hidden : null,
              mistakes: x.mistakes,
              brute: x.bruteText,
            });
          } catch (err) {
            if (r.available) {
              w(cfgFile, testsLine, `${where}的测试没跑完：${firstLine(err?.message ?? err)}`, '检查测试文件与参考答案能不能单独跑；再跑一次 check:lesson', 'tests-unverified');
              entry.solution = 'unverified';
              continue;
            }
          }
        }
        if (!r.available) {
          const why = String(r.reason ?? '').replace(/（[^）]*）$/, '') || 'Python 运行时不可用';
          w(cfgFile, testsLine, `${why}，${where}的测试没验证`, '在管理台左边第 4 步"上课准备"下载 Python 运行时后再跑一次 check:lesson', 'tests-unverified');
          entry.solution = 'unverified';
          continue;
        }
        // 每段跑完立即写（管理台检查 worker 超时被结束时，已跑完的段下次直接命中）
        if (m.solution !== 'timeout' && !m.incomplete && cacheable) {
          const disk = readCache(cacheFile);
          disk[key] = { hash, at: Date.now(), result: m };
          writeCache(cacheFile, disk);
        }
      }

      entry.solution = m.solution;
      entry.mutants = m.mutants;
      entry.ms = m.ms;
      // 3 参考答案跑测试（预算内连参考答案都没跑完 → 按"没跑完"）
      if (m.solution === 'timeout' && m.incomplete) {
        w(cfgFile, testsLine, `${where}测试在 ${Math.round(budgetMs / 1000)} 秒内没跑完（Python 起动或参考答案太慢），测试没验证`,
          '再跑一次 check:lesson（第二次起动快）；仍然这样就减小测试里的数据量', 'tests-timeout');
        continue;
      }
      if (m.solution === 'timeout') {
        w(solFile, solLine, `${where}参考答案跑了 20 秒还没完，看有没有死循环 / 等 input`,
          '参考答案里的循环要能结束；要读 input() 的题，测试里用 monkeypatch 喂输入（见 skills/参考/写测试.md）', 'tests-timeout');
        continue;
      }
      if (m.solution === 'fail') {
        const list = (m.run?.cases ?? []).map((c) => `${c.name}（${firstLine(c.reason)}）`).join('、');
        w(solFile, solLine, `${where}参考答案没通过测试：${list || '测试没能运行'}${m.run?.more ? '…' : ''}`,
          '要么测试写错，要么答案写错；对照失败用例改，不能删测试凑过', 'tests-solution-fail');
        continue;
      }
      // V2 隐藏用例过期 / 错误库 / 对拍（参考答案通过之后才有意义）
      const ex = m.extras ?? {};
      for (const he of ex.hidden?.errors ?? []) {
        w(path.join(stageDir, HIDDEN_JSON), null, `${where}隐藏用例 ${he.name} 用参考答案算不出：${firstLine(he.error)}`,
          '改 hidden.json 里这一条（表达式或输入写错了），或改参考答案', 'tests-hidden-error');
      }
      if (ex.hidden?.rendered && x.hiddenFile != null && (x.hiddenFile !== ex.hidden.rendered || (listed && tests[HIDDEN_FILE] !== ex.hidden.rendered))) {
        w(path.join(stageDir, HIDDEN_PATH), null, `${where}隐藏用例已过期（参考答案或 hidden.json 改过）`, `重跑 ${prepCmd}`, 'tests-hidden-stale');
      }
      if (ex.mistakes?.error) {
        w(path.join(stageDir, MISTAKES_DIR), null, `${where}错误库生成不了：${ex.mistakes.error}`, `改好后跑 ${prepCmd}`, 'tests-mistakes-stale');
      } else if (ex.mistakes) {
        if (x.mistakesJson !== ex.mistakes.json) {
          w(path.join(stageDir, x.mistakesJson == null ? MISTAKES_DIR : MISTAKES_JSON), null,
            x.mistakesJson == null ? `${where}错误库还没生成 ${MISTAKES_JSON}` : `${where}错误库 ${MISTAKES_JSON} 已过期（错误版本或测试改过）`,
            `重跑 ${prepCmd}`, 'tests-mistakes-stale');
        }
        const label = (mid) => ex.mistakes.labels?.[mid] ?? mid;
        for (const mid of ex.mistakes.uncaught) {
          w(path.join(stageDir, MISTAKES_DIR, `${mid}.py`), null, `${where}错误版本"${label(mid)}"没被测试抓住`,
            `补一条能让它失败的用例（测试或隐藏用例），再跑 ${prepCmd}`, 'tests-mistake-uncaught');
        }
        for (const [a, b] of ex.mistakes.same) {
          w(path.join(stageDir, MISTAKES_DIR, `${a}.py`), null, `${where}错误版本"${label(a)}"与"${label(b)}"失败的用例一样，上课分不开`,
            `补一条只让其中一个失败的用例，再跑 ${prepCmd}`, 'tests-mistake-same');
        }
      }
      if (ex.brute && ex.brute.failing.length > 0) {
        const list = ex.brute.failing.slice(0, 3).join('、') + (ex.brute.failing.length > 3 ? '…' : '');
        w(path.join(stageDir, BRUTE_FILE), null, `${where}笨办法解没通过测试：${list}——题意可能有歧义，或参考答案与笨办法解之一写错`,
          '对照这几条用例看题意：改错的那一个（参考答案、笨办法解或测试），不能删测试凑过', 'tests-brute-fail');
      }
      if (ex.incomplete) {
        w(cfgFile, testsLine, `${where}隐藏用例 / 错误库 / 对拍在 ${Math.round(budgetMs / 1000)} 秒内没跑完`,
          '再跑一次 check:lesson；仍然这样就减小测试里的数据量', 'tests-timeout');
      }
      // 4 变异检验
      const mu = m.mutants;
      if (m.incomplete && !ex.incomplete) {
        w(cfgFile, testsLine, `${where}变异检验没跑完（${Math.round(budgetMs / 1000)} 秒内跑了 ${mu.total} 个改坏的版本）`,
          '参考答案或测试太慢：减小测试里的数据量，再跑一次 check:lesson', 'tests-timeout');
      }
      if (mu.total >= MUTANTS_MIN_JUDGE && mu.killed / mu.total < KILL_RATE_MIN) {
        const eg = mu.survived.slice(0, 3).map((s) => s.desc).join('；');
        w(cfgFile, testsLine, `${where}测试抓不住 ${mu.total - mu.killed}/${mu.total} 个改坏的版本（如 ${eg}）`,
          `按这几个例子补边界用例（${WRITE_TESTS}）`, 'tests-weak');
      }
      // 5 全部通过 → 信息
      if (!warned) {
        infos.push({ level: 'info', file: rel(cfgFile), line: null,
          message: `代码题测试：段 ${id} 通过（用例 ${cases}，抓住 ${mu.killed}/${mu.total}）`, fix: '', rule: 'tests-pass' });
      }
    }
  } finally {
    if (runner) await runner.close?.();
  }
  return out;
}

// coach 组件规格 §2：stage.config.js 顶层 coach
export const COACH_INTRO_MAX = 60;
export function coachFieldOk(v) {
  if (typeof v === 'boolean') return true;
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0] === 'intro' && typeof v.intro === 'string' && v.intro.trim() !== ''
    && Array.from(v.intro).length <= COACH_INTRO_MAX;
}

// 11 AI 接口（统一 AI 接口规格 §5）：逐行查；client 为真时另查 ctx.ai / cctx.ai 与 fetch 外网
export function aiFindings(src, { client = false } = {}) {
  const text = String(src ?? '');
  const out = [];
  const bearerFile = AI_BEARER.auth.test(text) && AI_BEARER.bearer.test(text);
  text.split('\n').forEach((row, i) => {
    const line = i + 1;
    let hit = null;
    for (const r of AI_CODE_RULES) {
      const m = r.re.exec(row);
      if (m) {
        hit = r.label(m);
        break;
      }
    }
    if (!hit && bearerFile && (AI_BEARER.bearer.test(row) || AI_BEARER.auth.test(row))) hit = 'Authorization: Bearer';
    if (hit) out.push({ level: 'error', line, kind: 'ai-code', hit });
    if (client && AI_IN_CLIENT.test(row)) out.push({ level: 'error', line, kind: 'ai-client' });
    if (client && CLIENT_FETCH_HTTP.test(row)) out.push({ level: 'warning', line, kind: 'client-fetch' });
  });
  return out;
}

function aiCheck(file, src, opts, error, warn) {
  const base = path.basename(file);
  for (const h of aiFindings(src, opts)) {
    if (h.kind === 'ai-code') {
      error(file, h.line, `第 ${h.line} 行：课程代码不能自己连 AI 接口或写密钥（这一行有 ${h.hit}）`, AI_FIX, 'ai');
    } else if (h.kind === 'ai-client') {
      error(file, h.line, `AI 只能在 server.js 里调：${base} 第 ${h.line} 行用了 ctx.ai`,
        '视图发事件给本段 server.js，服务端 ctx.ai.chat 后写 ctx.data.set 或 emitToStudent，视图读记录显示（契约 §四）', 'ai');
    } else {
      warn(file, h.line, `学生端直接连外网（${base} 第 ${h.line} 行 fetch('http…')），机房常没外网，确认是否必要`,
        '要用外部数据就放进阶段目录随课带上；要 AI 结果就发事件给 server.js 用 ctx.ai.chat；平台接口用 /api/ 开头的相对路径', 'client-fetch');
    }
  }
}

function todoCheck(file, src, warn, fix = '把 TODO 换成本课的内容（照 STAGE.md 阶段卡填写）') {
  if (!src) return;
  const hits = [...src.matchAll(/\bTODO\b/g)];
  if (hits.length === 0) return;
  warn(file, lineAt(src, hits[0].index), `还有 ${hits.length} 处 TODO 占位`, fix, 'todo');
}

// ===== 13 课程组件（课程本地组件规格 §5）=====
// client.jsx 里用到的槽位名：slots.<名> 与 slots: { … } 对象字面量的顶层键（静态、文本级）
export function slotNamesIn(src) {
  const code = stripComments(src);
  const out = [];
  for (const m of code.matchAll(/\bslots\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)) out.push({ name: m[1], line: lineAt(code, m.index) });
  for (const m of code.matchAll(/\bslots\s*:\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let flat = '';
    for (let i = open; i < code.length; i += 1) {
      const c = code[i];
      const before = depth;
      if ('{(['.includes(c)) depth += 1;
      else if ('})]'.includes(c)) depth -= 1;
      if (depth === 0) break;
      // 只留对象顶层（嵌套内容换成空格，行号不变）；顶层的括号本身保留，认得出方法简写 name() { … }
      flat += before === 1 || depth === 1 || c === '\n' ? c : ' ';
    }
    for (const k of flat.matchAll(/(?:^|[{,])\s*(['"]?)([A-Za-z_$][\w$]*)\1\s*(?=[:,(}]|$)/g)) {
      out.push({ name: k[2], line: lineAt(code, open + k.index + k[0].indexOf(k[2])) });
    }
  }
  return out;
}

// 组件 server.js 里字面量注册的事件：cctx.on('…') / 裸 on('…')
export function componentOnEvents(src) {
  const code = stripComments(src);
  return [...code.matchAll(/(?<![\w$])on\(\s*(['"`])([^'"`\n]+)\1/g)].map((m) => ({ event: m[2], line: lineAt(code, m.index) }));
}

let freshSeq = 0;
// 逐个查 <课程目录>/components/<cid>/；返回有错误的组件 id（加载器对它们的英文报错不再重复）
async function checkLessonComponents({ root, componentsRoot, openIds, error, warn }) {
  const bad = new Set();
  const dirs = subdirs(root).sort();
  for (const cid of dirs) {
    const dir = path.join(root, cid);
    const at = (f) => path.join(dir, f);
    const files = walkFiles(dir);
    const noTests = files.filter((f) => !f.startsWith('__tests__/'));
    const has = (f) => files.includes(f);
    const err = (...a) => {
      bad.add(cid);
      error(...a);
    };
    const cfgFile = at('component.config.js');
    const cfgSrc = readText(cfgFile);
    const idLine = cfgSrc ? findLine(cfgSrc, /\bid\s*:/) : null;
    const rename = `换一个名字（小写字母开头，只含小写字母、数字和连字符，建议 x- 开头）：目录名、component.config.js 的 id 与 lesson.config.js 的 components 里一起改（见 ${COMPONENT_DOC}）`;

    // id：目录名合法、不是保留字 / 内置组件名、不与平台组件重名
    if (!COMPONENT_ID_RE.test(cid)) {
      err(cfgFile, idLine, `课程组件目录名 ${cid} 不能当组件 id`, rename, 'lesson-component');
    } else if (fs.existsSync(path.join(componentsRoot, cid))) {
      err(cfgFile, idLine, `课程组件 ${cid} 与平台组件重名，请改名`, rename, 'lesson-component');
    } else if (RESERVED_COMPONENT_IDS.includes(cid) || BUILTIN_COMPONENT_IDS.includes(cid)) {
      err(cfgFile, idLine, `课程组件 ${cid} 用了平台保留的名字`, rename, 'lesson-component');
    }

    // component.config.js：默认导出 { id, label }，id 与目录名一致
    if (cfgSrc === null) {
      err(cfgFile, null, `课程组件 ${cid} 缺 component.config.js`,
        `建 component.config.js：export default { id: '${cid}', label: '<中文名>' }（npm run new:component 会生成整套骨架）`, 'lesson-component');
    } else {
      let cfg;
      let importErr = null;
      try {
        cfg = (await import(`${pathToFileURL(cfgFile).href}?check-lesson=${++freshSeq}`)).default;
      } catch (e) {
        importErr = e;
      }
      if (importErr) {
        const syn = await syntaxErrorAt(cfgSrc);
        err(cfgFile, syn?.line ?? null, `component.config.js 读不出来：${importErr?.message ?? importErr}`, '按指出的行修正语法；只写 export default { id, label }', 'lesson-component');
      } else if (!isPlainObject(cfg)) {
        err(cfgFile, findLine(cfgSrc, /\bexport\s+default\b/), 'component.config.js 没有默认导出对象',
          `写成 export default { id: '${cid}', label: '<中文名>' }`, 'lesson-component');
      } else {
        if (cfg.id !== cid) {
          err(cfgFile, idLine, `component.config.js 的 id 是 ${JSON.stringify(cfg.id) ?? '（没写）'}，与目录名 ${cid} 不一致`,
            `把 id 改成 '${cid}'（或把目录改名成与 id 一致）`, 'lesson-component');
        }
        if (typeof cfg.label !== 'string' || cfg.label.trim() === '') {
          err(cfgFile, findLine(cfgSrc, /\blabel\s*:/) ?? idLine, 'component.config.js 没有写 label（教师端显示的中文名）',
            "加上 label: '<中文名>'，如 label: '作品墙'", 'lesson-component');
        }
      }
    }

    // 代码文件语法；server.js 导出 register、事件前缀是自己的 id；client.jsx 过 check:ui、只用契约槽位
    for (const f of noTests.filter((x) => /\.(jsx?|mjs)$/.test(x) && x !== 'component.config.js')) {
      const src = readText(at(f)) ?? '';
      const syn = await syntaxErrorAt(src, { lang: f.endsWith('.jsx') ? 'jsx' : undefined });
      if (syn) {
        err(at(f), syn.line, `${path.posix.basename(f)} 有语法错误：${syn.message}`, '按指出的行修正语法（括号、引号、逗号、标签是否配对）', 'syntax');
        continue;
      }
      aiCheck(at(f), src, { client: f.endsWith('.jsx') }, err, warn);
      if (f.endsWith('.jsx')) {
        for (const h of scanSource(src, `components/${cid}/${f}`)) {
          err(at(f), h.line, `界面规则：${h.message}`, UI_FIXES[h.rule] ?? `对照${CONTRACT} §四"页面与布局"修改`, `ui:${h.rule}`);
        }
      }
    }
    if (has('server.js')) {
      const src = readText(at('server.js')) ?? '';
      const facts = await moduleFacts(src);
      if (facts && !facts.exports.has('register') && !facts.exports.has('*')) {
        err(at('server.js'), findLine(src, /\bregister\b/), '组件 server.js 没有导出 register，平台启动时会失败',
          `写成 export function register(cctx) { … }（${COMPONENT_DOC}）`, 'lesson-component');
      }
      for (const { event, line } of componentOnEvents(src)) {
        if (event.startsWith(`${cid}:`)) continue;
        err(at('server.js'), line, `组件 ${cid} 注册了事件 ${event}：组件事件必须以自己的 id 开头`,
          `改成 ${cid}:s-…（学生发）或 ${cid}:t-…（教师发），视图里 send 的事件名一起改`, 'lesson-component');
      }
    }
    if (has('client.jsx')) {
      const src = readText(at('client.jsx')) ?? '';
      for (const { name, line } of slotNamesIn(src)) {
        if (CONTRACT_SLOTS.includes(name)) continue;
        err(at('client.jsx'), line, `slots 里的 ${name} 不是平台的槽位，不会显示`,
          `改成 ${CONTRACT_SLOTS.join(' / ')} 之一（${CONTRACT} §八）`, 'lesson-component');
      }
    }
    if (!has('README.md')) {
      warn(at('README.md'), null, `课程组件 ${cid} 缺 README.md`,
        '写 README.md：这是什么、开在哪些段、数据形状（给以后改这节课的 AI 看）', 'lesson-component');
    }
    if (!openIds.includes(cid)) {
      warn(cfgFile, null, `课程组件 ${cid} 还没在 lesson.config.js 的 components 里打开，上课时不会出现`,
        `lesson.config.js 的 components 里加上 '${cid}'；不要了就删掉这个目录`, 'lesson-component');
    }
    for (const f of files.filter((x) => TEXT_EXT.test(x) && !x.startsWith('__tests__/'))) {
      todoCheck(at(f), readText(at(f)), warn, `把 TODO 换成这个组件的内容（照组件 README.md 与 ${COMPONENT_DOC}）`);
    }
  }
  return bad;
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

// 14：信息行（代码题测试通过）在末尾汇总行之前
export function formatReport(r) {
  const infos = (r.infos ?? []).map((i) => `信息  ${i.message}`);
  return [...r.errors, ...r.warnings].map(formatItem).concat(infos, summaryLine(r)).join('\n');
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
  const noCache = argv.includes('--no-cache');
  const target = argv.find((a) => !a.startsWith('--')) ?? envLessonConfig(cwd) ?? './lesson.config.js';
  const r = await checkLesson(target, { root: cwd, noCache });
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
