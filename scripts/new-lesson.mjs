#!/usr/bin/env node
// npm run new:lesson -- --id <id> --title <课名> [--dir lessons] [--no-env]（L1）：新建一门课的骨架，AI 从这里填空。
//   生成 <dir>/<id>/lesson.config.js（对象字面量、注释齐全、stages: []、components 缺省 ['mirror','share','report']）、
//   stages/.gitkeep、README.md；把 .env 的 LESSON_CONFIG 指向它（--no-env 不写）。id 规则同阶段 id；目录已存在则拒绝。
//   newLesson({ root, id, title, dir = 'lessons', env = true }) → { dir, configPath, configRel, envWritten }（出错抛 Error，文案面向 AI / 教师）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STAGE_ID_RE, RESERVED_STAGE_IDS } from '../kernel/server/stage-loader.js';
import { LESSON_ID_RE, isWindowsReservedName, windowsReservedMessage } from '../kernel/server/lesson-db-path.js';
import { ensureEnv, writeEnv } from './manage/env-file.js';
import { quoteJs } from './lib/config-edit.js';
import { parseFlags } from './lib/flags.js';
import { toPosix } from './lib/lesson-source.js';

export const DEFAULT_COMPONENTS = ['mirror', 'share', 'report'];

function lessonConfigSource({ id, title }) {
  const glyph = Array.from(title.trim())[0];
  return `// ${title}（npm run new:lesson 生成）。阶段用 npm run new:stage 添加，改完跑 npm run check:lesson。
// 字段说明见契约（docs/02-阶段模块契约.md）§一；工作台左栏与课名标题行显示 title。
export default {
  id: ${quoteJs(id)},${' '.repeat(Math.max(1, 22 - id.length))}// 持久化用，改名视为新课
  title: ${quoteJs(title)},
  glyph: ${quoteJs(glyph)},                    // 登录页与头部的一字标识
  theme: {},                      // 覆盖主题 token，如 { brand: '#2B3A55' }
  roster: { mode: 'roster' },     // 'roster' | 'free'：课前页默认显示导入名单卡还是自由起名提示
  stagesDir: './stages',          // 相对本文件所在目录
  stages: [],                     // 阶段目录名，顺序即课堂顺序；npm run new:stage 会追加（prelogin 与 curtain 由内核加在首尾）
  curtain: { label: '总结', override: null },   // 谢幕；override：stagesDir 下的目录名（不列入 stages）
  // 可选组件：镜像 / 分享 / 个人报告；用 code / data-analysis 原语时 new:stage 会自动加上 'sandbox'
  components: ['mirror', 'share', 'report'],
};
`;
}

function readmeSource({ title, configRel, dirRel }) {
  return `# ${title}

这门课由 \`npm run new:lesson\` 生成。启动：在工作台左栏点《${title}》（或 \`.env\` 写 \`LESSON_CONFIG=${configRel}\`），再到"启动上课"页签点"启动平台"。
加阶段：\`npm run new:stage -- --lesson ${configRel} --id <id> --label <阶段名> --primitive <vote|quiz|free-text|code|data-analysis|none>\`，
会在 \`${dirRel}/stages/\` 下生成 \`NN-<id>/\`（阶段卡 STAGE.md + 配置或骨架）并追加进 \`lesson.config.js\` 的 \`stages\`；
按阶段卡把 \`TODO：\` 占位填完，再跑 \`npm run check:lesson\`，直到只剩"通过"。
`;
}

export async function newLesson({ root = process.cwd(), id, title, dir = 'lessons', env = true } = {}) {
  if (typeof id !== 'string' || !STAGE_ID_RE.test(id) || !LESSON_ID_RE.test(id)) {
    throw new Error(`id ${JSON.stringify(id ?? '')} 不合法：用小写字母开头，只含小写字母、数字和连字符，2–40 个字符（如 prime-intro）`);
  }
  if (RESERVED_STAGE_IDS.includes(id)) throw new Error(`id "${id}" 是保留字，换一个`);
  if (isWindowsReservedName(id)) throw new Error(windowsReservedMessage(id));
  if (typeof title !== 'string' || title.trim() === '' || /[\r\n]/.test(title)) throw new Error('请用 --title 给出课名（一行文字）');
  const dirRel = toPosix(path.posix.join(toPosix(dir), id)).replace(/^\.\//, '');
  const absDir = path.resolve(root, dirRel);
  if (fs.existsSync(absDir)) throw new Error(`${dirRel} 已存在，换一个 id，或删掉那个目录再生成`);
  const configRel = `./${dirRel}/lesson.config.js`;
  fs.mkdirSync(path.join(absDir, 'stages'), { recursive: true });
  fs.writeFileSync(path.join(absDir, 'lesson.config.js'), lessonConfigSource({ id, title: title.trim() }));
  fs.writeFileSync(path.join(absDir, 'stages', '.gitkeep'), '');
  fs.writeFileSync(path.join(absDir, 'README.md'), readmeSource({ title: title.trim(), configRel, dirRel }));
  let envWritten = false;
  if (env) {
    ensureEnv(root);
    writeEnv(root, { LESSON_CONFIG: configRel });
    envWritten = true;
  }
  return { dir: absDir, configPath: path.join(absDir, 'lesson.config.js'), configRel, envWritten };
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = (l) => console.log(l) } = {}) {
  let flags;
  try {
    flags = parseFlags(argv, { values: ['id', 'title', 'dir'], booleans: ['no-env'] });
    const r = await newLesson({ root: cwd, id: flags.id, title: flags.title, dir: flags.dir ?? 'lessons', env: !flags['no-env'] });
    log(`已生成 ${toPosix(path.relative(cwd, r.dir))}/（lesson.config.js、stages/、README.md）`);
    log(r.envWritten ? `.env 的 LESSON_CONFIG 已改为 ${r.configRel}` : '没有改 .env（--no-env）');
    log(`下一步：npm run new:stage -- --lesson ${r.configRel} --id <id> --label <阶段名> --primitive <vote|quiz|free-text|code|data-analysis|none>`);
    return 0;
  } catch (err) {
    log(`new:lesson 没有生成：${err?.message ?? err}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
