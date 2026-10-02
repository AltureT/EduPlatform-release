// 文字修正（S21 §3，原 S20 §3 随平台抽文本一起写的，S21 撤掉抽文本后单独留下）：教案页粘贴的文字保存前调用
//   fixRadicals(text)：康熙部首（U+2F00–U+2FD5）/ 部首补充（U+2E80–U+2EF3）码位还原成常用字，其它字符不动
//     Mac Quartz 导出的 PDF 会把常用字存成这两段码位，复制粘贴出来看着一样、搜索对照全错
//     部首补充区大多没有 NFKC 分解（"首⻚""可⻅""⻔槛"）→ 先查 RADICAL_MAP，表里没有的再 NFKC，还是没变的原样保留
export const RADICAL_MAP = Object.freeze({
  '\u2E81': '厂', '\u2E85': '亻', '\u2E89': '刂', '\u2E92': '巳', '\u2E93': '幺', '\u2E95': '彐', '\u2E96': '忄', '\u2E98': '扌',
  '\u2E99': '攵', '\u2E9B': '旡', '\u2E9D': '月', '\u2E9F': '母', '\u2EA0': '民', '\u2EA1': '氵', '\u2EA2': '氺', '\u2EA3': '灬',
  '\u2EA4': '爫', '\u2EA7': '牜', '\u2EA8': '犭', '\u2EA9': '王', '\u2EAA': '疋', '\u2EAB': '罒', '\u2EAC': '示', '\u2EAD': '礻',
  '\u2EAE': '竹', '\u2EAF': '糸', '\u2EB0': '纟', '\u2EB2': '罒', '\u2EB6': '羊', '\u2EB9': '耂', '\u2EBA': '肀', '\u2EBC': '月',
  '\u2EBD': '臼', '\u2EBE': '艹', '\u2EBF': '艹', '\u2EC0': '艹', '\u2EC1': '虎', '\u2EC2': '衤', '\u2EC3': '襾', '\u2EC4': '西',
  '\u2EC5': '见', '\u2EC6': '角', '\u2EC7': '角', '\u2EC8': '讠', '\u2EC9': '贝', '\u2ECA': '足', '\u2ECB': '车', '\u2ECC': '辶',
  '\u2ECD': '辶', '\u2ECE': '辶', '\u2ECF': '阝', '\u2ED0': '钅', '\u2ED1': '長', '\u2ED2': '镸', '\u2ED3': '长', '\u2ED4': '门',
  '\u2ED5': '阝', '\u2ED6': '阝', '\u2ED7': '雨', '\u2ED8': '青', '\u2ED9': '韦', '\u2EDA': '页', '\u2EDB': '风', '\u2EDC': '飞',
  '\u2EDD': '食', '\u2EDE': '飠', '\u2EDF': '飠', '\u2EE0': '饣', '\u2EE1': '首', '\u2EE2': '马', '\u2EE3': '骨', '\u2EE4': '鬼',
  '\u2EE5': '鱼', '\u2EE6': '鸟', '\u2EE7': '卤', '\u2EE8': '麦', '\u2EE9': '黄', '\u2EEA': '黾', '\u2EEB': '斉', '\u2EEC': '齐',
  '\u2EED': '歯', '\u2EEE': '齿', '\u2EEF': '竜', '\u2EF0': '龙', '\u2EF1': '龜', '\u2EF2': '亀', '\u2EF3': '龟',
});
const RADICALS = /[\u2E80-\u2EF3\u2F00-\u2FD5]/gu;
export function fixRadicals(text) {
  return String(text ?? '').replace(RADICALS, (c) => RADICAL_MAP[c] ?? c.normalize('NFKC'));
}
