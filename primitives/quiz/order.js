// quiz 题序（服务端与客户端同一算法）：shuffle 为 true 时按学生名做稳定种子打乱——同一学生刷新、换设备题序不变，
// 不同学生题序不同。FNV-1a 32 位散列 → mulberry32 → Fisher–Yates。纯函数，无 Node / 浏览器依赖。

function hash(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(list, seed) {
  const out = [...list];
  const rand = mulberry32(hash(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 某学生看到的题目 id 顺序
export function itemOrder(options, name) {
  const ids = (options?.items ?? []).map((it) => it.id);
  if (!options?.shuffle) return ids;
  return seededShuffle(ids, `quiz:${name ?? ''}`);
}
