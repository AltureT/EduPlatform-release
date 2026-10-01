#!/usr/bin/env node
// 启动前检查（代码沙盒规格 §2.3；内核附带，组件无关）：命令行版；工作台启动平台前在进程内做同样的检查（scripts/manage/process.js）
// 读课程配置（.env / 环境变量 LESSON_CONFIG，默认 ./lesson.config.js），对已打开组件在 component.config.js 里
// 声明的 requires: [{ path, hint }] 逐项检查 path（相对项目根）是否存在；缺则打印该项 hint 并以 1 退出，全部存在以 0 退出
// 测试用覆盖：COMPONENTS_ROOT（默认 <项目根>/components）、VENDOR_ROOT（requires 路径的基准，默认 <项目根>，与 createApp 的 vendorRoot 同义）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { loadComponents, lessonComponentsRootOf } from '../kernel/server/component-loader.js';

dotenv.config({ quiet: true });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lessonPath = path.resolve(process.env.LESSON_CONFIG || './lesson.config.js');
const componentsRoot = path.resolve(process.env.COMPONENTS_ROOT || path.join(ROOT, 'components'));
const baseDir = path.resolve(process.env.VENDOR_ROOT || ROOT);

async function main() {
  const { default: lessonConfig } = await import(pathToFileURL(lessonPath).href);
  const components = await loadComponents(lessonConfig, componentsRoot, { lessonComponentsRoot: lessonComponentsRootOf(lessonPath) });
  const missing = [];
  for (const c of components) {
    for (const r of c.requires) {
      if (!fs.existsSync(path.resolve(baseDir, r.path))) missing.push({ id: c.id, label: c.label, ...r });
    }
  }
  if (missing.length === 0) return 0;
  for (const m of missing) {
    console.error(`✗ 组件「${m.label}」缺少 ${m.path}`);
    console.error(`  ${m.hint}`);
  }
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`✗ 启动前检查失败：${err?.message ?? err}`);
    process.exit(2);
  },
);
