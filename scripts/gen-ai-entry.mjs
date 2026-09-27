#!/usr/bin/env node
// npm run gen:ai-entry（框架自描述规格 §3）：按 scripts/lib/ai-entry.js 的 AI_ENTRY_TEXT 重新生成各 AI 工具的入口文件
//   node scripts/gen-ai-entry.mjs [--check]
//     缺省写文件（内容相同的不动），打印"已更新 / 未变"；--check 只比对，有不一致退出 1（不写）
// 导出供测试：genAiEntry({ root, check })
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AI_ENTRY_FILES, renderEntry } from './lib/ai-entry.js';

const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function genAiEntry({ root = PLATFORM_ROOT, check = false } = {}) {
  const changed = [];
  const same = [];
  for (const f of AI_ENTRY_FILES) {
    const abs = path.join(root, f.path);
    const want = renderEntry(f);
    let have = null;
    try {
      have = fs.readFileSync(abs, 'utf8');
    } catch {
      have = null;
    }
    if (have === want) {
      same.push(f.path);
      continue;
    }
    changed.push(f.path);
    if (!check) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, want);
    }
  }
  return { changed, same };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check');
  const { changed, same } = genAiEntry({ check });
  for (const p of changed) console.log(`${check ? '不一致' : '已更新'}  ${p}`);
  console.log(`${AI_ENTRY_FILES.length} 个入口文件：${check ? '不一致' : '更新'} ${changed.length} 个，未变 ${same.length} 个`);
  if (check && changed.length) process.exitCode = 1;
}
