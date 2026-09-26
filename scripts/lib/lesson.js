// 课程配置定位与阶段模拟模块加载（规格 §4、§10；契约 §七）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** LESSON_CONFIG（缺省 ./lesson.config.js）相对 cwd 解析为绝对路径 */
export function lessonConfigPath() {
  return path.resolve(process.cwd(), process.env.LESSON_CONFIG || './lesson.config.js');
}

/** 冻结导出 loadLesson(configPath) → { lessonConfig, stagesRoot, stages:[{ id, dir, config, hasDemo }] }（T2 提供） */
export async function loadLesson(configPath) {
  // 动态 import：脚本模块本身可在 stage-loader 缺席时被加载（自测注入替身）
  const mod = await import('#kernel/server/stage-loader.js');
  return mod.loadLesson(configPath);
}

/**
 * 阶段的模拟片段路径：<stage.dir>/__tests__/simulate.js；
 * v0.8：原语阶段（stage.primitiveDir 非空）阶段目录没有该文件时退到 <primitiveDir>/__tests__/simulate.js
 */
export function simulateFileOf(stage) {
  const own = path.join(path.resolve(stage.dir), '__tests__', 'simulate.js');
  if (stage.primitiveDir && !fs.existsSync(own)) return path.join(path.resolve(stage.primitiveDir), '__tests__', 'simulate.js');
  return own;
}

/** import 模拟片段 → { play, loadAction } */
export async function importStageSimulate(stage) {
  return import(pathToFileURL(simulateFileOf(stage)).href);
}
