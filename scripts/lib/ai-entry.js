// 各 AI 开发工具的入口文件（框架自描述规格 §3）：正文同源，只有这一份常量 AI_ENTRY_TEXT。
//   AI_ENTRY_FILES：[{ path（相对平台目录）, tool, frontMatter }]；文件内容 = frontMatter + AI_ENTRY_TEXT（renderEntry）
//   改正文或加工具：只改这里，再在平台目录跑 npm run gen:ai-entry 重新生成；scripts/__tests__/ai-entry.test.js 保证文件与常量一致
//   这些文件都算平台文件（platform-files.js 的 protected 清单），发布包一起发出

export const AI_ENTRY_TEXT = `# 班迹（平台目录）

1. 这里是班迹的平台目录（教师电脑上跑的就是它）。先看框架地图 \`docs/00-框架地图.md\`：哪些能复用、哪些能自定义、哪些不能动，一页说清。
2. 教师要做一节课、改一节课、上课前检查：先完整读 \`skills/SKILL.md\`，再按它一步一步做；命令都在本目录执行。
3. 对话里贴进来的是"阶段审查清单"：就只按那份清单审查，不读 \`skills/SKILL.md\`、不做课。
4. 不能动：\`kernel/\`、\`components/\`、\`primitives/\`、\`scripts/\`、\`docs/\`、\`skills/\`。要的功能平台没有，就告诉教师，记进这门课 \`平台规格.md\` 的"后续定制"，不要改平台文件绕过（升级时会被覆盖，\`npm run check:lesson\` 也会报"平台文件被改过"）；平台问题按 \`docs/排障手册.md\` 写反馈文件，不要打补丁。
5. 不碰 \`data/\`、\`backups/\`、\`.env\`、\`vendor/\`（\`.env\` 只由 \`npm run new:lesson\` 与工作台写）。
6. 课程只在 \`lessons/<id>/\` 下写（这节课自己的组件放 \`lessons/<id>/components/\`，写法见 \`docs/06-组件契约.md\`）；样式只用 \`docs/05-样式约定.md\` 的令牌与组件；要用 AI 只在服务端走 \`ctx.ai\`（\`docs/02-阶段模块契约.md\` §三），不写接口地址与密钥。
7. 写完跑 \`npm run check:lesson\`，有"错误"先改完再交给教师。
8. 对教师说话按 \`skills/SKILL.md\`"对教师说话"的规矩：只用教学词，不露文件名、路径、命令、版本号。
9. 老师贴来排障文件（\`排障/\` 里的文件，或说"启动失败 / 打不开 / 更新失败"）：只按 \`docs/排障手册.md\` 处理，不读 \`skills/SKILL.md\`、不做课；能改的只有 \`lessons/<id>/\` 与 \`排障/\` 里的反馈文件。
`;

export const AI_ENTRY_FILES = [
  { path: 'CLAUDE.md', tool: 'Claude Code', frontMatter: '' },
  { path: 'AGENTS.md', tool: 'Codex / 通用', frontMatter: '' },
  {
    path: '.cursor/rules/eduplatform.mdc',
    tool: 'Cursor',
    frontMatter: '---\ndescription: 班迹的做课规矩（每次对话都适用）\nglobs:\nalwaysApply: true\n---\n\n',
  },
  { path: '.windsurf/rules/eduplatform.md', tool: 'Windsurf', frontMatter: '---\ntrigger: always_on\n---\n\n' },
  { path: '.github/copilot-instructions.md', tool: 'GitHub Copilot', frontMatter: '' },
  { path: '.trae/rules/project_rules.md', tool: 'Trae', frontMatter: '' },
  { path: '.clinerules/eduplatform.md', tool: 'Cline', frontMatter: '' },
  { path: '.roo/rules/eduplatform.md', tool: 'Roo Code', frontMatter: '' },
  { path: 'GEMINI.md', tool: 'Gemini CLI', frontMatter: '' },
  { path: 'QWEN.md', tool: 'Qwen Code', frontMatter: '' },
];

export const AI_ENTRY_PATHS = AI_ENTRY_FILES.map((f) => f.path);

export function renderEntry(file) {
  return `${file.frontMatter}${AI_ENTRY_TEXT}`;
}

// 去掉开头的 --- … --- front matter（及其后空行），返回正文
export function entryBody(text) {
  const m = /^---\n[\s\S]*?\n---\n\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}
