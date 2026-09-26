// 冻结接口（规格 §10）：memDb() → openDb(':memory:')
// 依赖 #kernel/server/db.js（T2 提供）；T2 合并前本模块及 index.js 无法被 import
import { openDb } from '#kernel/server/db.js';

export function memDb() {
  return openDb(':memory:');
}
