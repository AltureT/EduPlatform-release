#!/usr/bin/env node
// npm run new:component -- <lesson.config.js 路径> <cid> --label <中文名> [--no-prefix]（C5，课程本地组件规格 §5）
//   在 lesson.config.js 所在目录的 components/<cid>/ 下生成课程组件骨架：component.config.js、server.js（register 空骨架 +
//   注释里的 report 示例）、client.jsx（studentAside 返回 null 的骨架 + 注释列出可用槽位）、stageConfig.js（按段开关：读阶段 stage.config.js
//   顶层的 '<cid>' 字段，同 examples/primitives-tour/components/gallery/stageConfig.js）、README.md（给 AI：是什么、开在哪些段、数据形状）、
//   __tests__/server.test.js（用 #kernel/test-utils/mockCctx.js）。id 缺省加 x- 前缀（已是 x- 开头或 --no-prefix 时不加），
//   以防将来与平台组件撞名。不改 lesson.config.js，只提示怎么打开。组件写法见 docs/06-组件契约.md。
//   newComponent({ root, lesson, id, label, prefix = true }) → { id, dir, files }（出错抛 Error，文案面向 AI / 教师）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  COMPONENT_ID_RE, RESERVED_COMPONENT_IDS, BUILTIN_COMPONENT_IDS, lessonComponentsRootOf,
} from '../kernel/server/component-loader.js';
import { quoteJs } from './lib/config-edit.js';
import { toPosix } from './lib/lesson-source.js';

export const LESSON_COMPONENT_PREFIX = 'x-';
const DEFAULT_COMPONENTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');

export const componentConfigSource = ({ id, label }) => `// ${label}（课程组件，npm run new:component 生成）。写法见 docs/06-组件契约.md；只在这节课里有效。
export default { id: ${quoteJs(id)}, label: ${quoteJs(label)} };
`;

export const serverSource = ({ id }) => `// ${id} 服务端（docs/06-组件契约.md）：register(cctx) 注册事件、写数据、挂钩子。
// 事件名 ${id}:s-…（学生发）/ ${id}:t-…（教师发）；数据用 cctx.data（perStudent / perClass），不写学生真名以外的身份信息到全班数据。
// import { shape } from '#kernel/server/schema.js';

export function register(cctx) {
  // TODO：按 README.md 写事件与数据，例如
  // cctx.on('${id}:t-open', shape({}), () => cctx.data.setClass({ open: true }));
  // cctx.hooks.onReset(() => { /* 课堂重置时清掉内存状态 */ });
}

// 可选：个人报告里加一节（标题 = 组件名）；不需要就删掉
// export function report(name, cctx) {
//   const rec = cctx.data.get(name) ?? {};
//   return [{ label: '次数', value: rec.count ?? 0 }];
// }
`;

export const clientSource = ({ id }) => `// ${id} 客户端（docs/06-组件契约.md）：slots 按名字把内容放进平台的固定位置。
// 可用槽位：studentAside（学生页题目栏或主区下方一块）、studentBanner（学生页顶部一行）、studentOverlay（学生端弹层，只放 Overlay）、
//   studentCurtain（学生谢幕页格子）、teacherToolbar（教师顶栏按钮）、teacherSidebar（统计视图右侧栏）、teacherOverlay（教师端弹层，只放 Overlay）、
//   teacherMain（包裹教师主区）、teacherCurtain（教师谢幕页格子）。只从 #kernel/client/index.js 取组件，样式只用令牌。
// 按段开关：读本段 stage.config.js 顶层的 ${quoteJs(id)} 字段（stageConfig.js）；c.isEnabledFor 只看 stage.config.components，不是按段开关
import { useComponent } from '#kernel/client/index.js';
import { useStageOn } from './stageConfig.js';

const ID = ${quoteJs(id)};

function StudentAside({ stageId }) {
  const c = useComponent(ID);
  const on = useStageOn(stageId);
  if (!on) return null;
  // TODO：在开了本组件的段显示一块内容（读 c.data.my / c.data.perClass）
  return null;
}

export default {
  slots: {
    studentAside: StudentAside,
  },
  store: {
    student: { initial: {}, on: {} },
    teacher: { initial: {}, on: {} },
  },
};
`;

export const stageConfigSource = ({ id }) => `// 按段开关（docs/06-组件契约.md §一）：阶段 stage.config.js 顶层写 ${quoteJs(id)}: true 的段才开本组件。
// 单独成模块：组件单测里用 vi.mock('../stageConfig.js') 提供假阶段配置（同 examples/primitives-tour/components/gallery/stageConfig.js）
import { useStudentStage } from '#kernel/client/index.js';

export const stageOn = (stage) => stage?.[${quoteJs(id)}] === true;

export function useStageOn(stageId) {
  const { stage } = useStudentStage(stageId);
  return stageOn(stage);
}
`;

export const readmeSource = ({ id, label }) => `# ${label}（课程组件 ${id}）

给以后改这节课的 AI 看。组件写法见平台的 docs/06-组件契约.md。

- 这是什么：TODO（一句话：教师要的功能）
- 开在哪些段：TODO（在这些段的 stage.config.js 顶层写 ${quoteJs(id)}: true；或写"全程"）
- 学生端看到：TODO
- 教师端看到：TODO
- 事件：TODO（${id}:s-… / ${id}:t-…，载荷形状）
- 数据形状：TODO（perStudent[name] = { … }；perClass = { … }）
`;

export const testSource = ({ id }) => `// ${id} 服务端测试（mockCctx：docs/06-组件契约.md"测试写法"）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockCctx } from '#kernel/test-utils/mockCctx.js';
import { register } from '../server.js';

test('register 不抛错', () => {
  const cctx = mockCctx({ id: ${quoteJs(id)}, stages: [{ id: 's1', config: { id: 's1', label: '一' } }], students: [{ name: '张三' }] });
  register(cctx);
  assert.equal(cctx.id, ${quoteJs(id)});
  // TODO：await cctx.dispatch('${id}:t-…', { role: 'teacher' }, {}) 后断言 cctx.data.getClass() / cctx.data.get('张三')
});
`;

export function withPrefix(id, prefix = true) {
  if (!prefix || typeof id !== 'string' || id.startsWith(LESSON_COMPONENT_PREFIX)) return id;
  return `${LESSON_COMPONENT_PREFIX}${id}`;
}

export async function newComponent({ root = process.cwd(), lesson, id, label, prefix = true, componentsRoot = DEFAULT_COMPONENTS_ROOT } = {}) {
  if (typeof lesson !== 'string' || !lesson) throw new Error('第一个参数写课程配置路径，如 lessons/my-lesson/lesson.config.js');
  const absConfig = path.resolve(root, lesson);
  if (!fs.existsSync(absConfig)) throw new Error(`找不到课程配置 ${lesson}`);
  if (typeof id !== 'string' || !id) throw new Error('第二个参数写组件 id，如 gallery（缺省会加 x- 前缀成 x-gallery）');
  const cid = withPrefix(id, prefix);
  if (!COMPONENT_ID_RE.test(cid)) {
    throw new Error(`组件 id ${JSON.stringify(cid)} 不合法：用小写字母开头，只含小写字母、数字和连字符（如 x-gallery）`);
  }
  if (RESERVED_COMPONENT_IDS.includes(cid) || BUILTIN_COMPONENT_IDS.includes(cid) || fs.existsSync(path.join(componentsRoot, cid))) {
    throw new Error(`组件 id "${cid}" 与平台组件或保留字重名，换一个（建议 x- 开头）`);
  }
  if (typeof label !== 'string' || label.trim() === '' || /[\r\n]/.test(label)) throw new Error('请用 --label 给出组件的中文名（一行文字），如 --label "作品墙"');
  const lessonComponents = lessonComponentsRootOf(absConfig);
  if (path.resolve(lessonComponents) === path.resolve(componentsRoot)) {
    throw new Error('课程配置在平台根目录上，课程组件要放在课程自己的目录里（lessons/<id>/components/）');
  }
  const dir = path.join(lessonComponents, cid);
  if (fs.existsSync(dir)) throw new Error(`${toPosix(path.relative(root, dir))} 已存在，换一个 id 或先删掉那个目录`);

  const args = { id: cid, label: label.trim() };
  const files = {
    'component.config.js': componentConfigSource(args),
    'server.js': serverSource(args),
    'client.jsx': clientSource(args),
    'stageConfig.js': stageConfigSource(args),
    'README.md': readmeSource(args),
    '__tests__/server.test.js': testSource(args),
  };
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return { id: cid, dir, files: Object.keys(files) };
}

// 参数：两个位置参数（课程配置、组件 id）+ --label <值> / --label=<值> + --no-prefix
export function parseArgs(argv) {
  const pos = [];
  const out = { prefix: true };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '--no-prefix') out.prefix = false;
    else if (a === '--label') {
      const v = args.shift();
      if (v === undefined || v === '' || v.startsWith('--')) throw new Error('参数 --label 缺少值');
      out.label = v;
    } else if (a.startsWith('--label=')) out.label = a.slice('--label='.length);
    else if (a.startsWith('--')) throw new Error(`不认识的参数 ${a}（可用：--label <中文名> --no-prefix）`);
    else pos.push(a);
  }
  if (pos.length > 2) throw new Error(`多了参数 ${pos.slice(2).join(' ')}（用法：npm run new:component -- <课程配置> <组件 id> --label <中文名>）`);
  [out.lesson, out.id] = pos;
  return out;
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = (l) => console.log(l) } = {}) {
  try {
    const a = parseArgs(argv);
    const r = await newComponent({ root: cwd, lesson: a.lesson, id: a.id, label: a.label, prefix: a.prefix });
    const relDir = toPosix(path.relative(cwd, r.dir));
    log(`已生成 ${relDir}/：${r.files.join('、')}`);
    log(`没有改 lesson.config.js：要启用就在它的 components 里加上 '${r.id}'；要在哪些段出现，就在那些段的 stage.config.js 顶层写 '${r.id}': true`);
    log(`下一步：按 docs/06-组件契约.md 写 server.js 与 client.jsx，填 README.md，再跑 npm run check:lesson 与 node --test ${relDir}/__tests__/server.test.js`);
    return 0;
  } catch (err) {
    log(`new:component 没有生成：${err?.message ?? err}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
