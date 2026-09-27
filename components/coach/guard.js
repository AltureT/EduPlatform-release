// coach 输入侧规则（coach 组件规格 §12.3）：纯函数，只在服务端用
// screen(question, recent = []) → { hit: null | 'answer' | 'inject' }
//   answer = 索要答案 / 完整代码；inject = 让助手忘掉规则、换身份、套提示词
//   两种视图都匹配：归一化视图（NFKC、去零宽字符、小写）与紧凑视图（再去掉空白与标点）
//   跨轮拼接：recent = 本段最近 2 条学生提问（旧→新），各取末 60 字，与当前问题拼成一串再查一次；
//     只认"碰到当前问题"的命中（整条落在旧提问里的不算，否则一次被拒会连累后面两问）
// clean(s)：NFKC + 去零宽字符（不改大小写、不去空白），buildUser 对 question 用它
// 规则表 ANSWER / INJECT 导出为常量，README 列出；不做教师自定义
// 防 ReDoS：重复组一律有上限（{0,n}），选项互不重叠（"看看"由"看"{0,3} 覆盖），不写嵌套量词；
//   guard.test.js 对每条规则喂 500 字的恶意重复输入，screen 须 < 50 ms
// 设计取舍：规则要求"动词 + 宾语"同现（"这题答案是不是应该输出 3 个数"不算索答），
//   宽泛的词（"你是"、"所有的代码"、"把代码写"）加了限定，避免误伤正常提问

export const RECENT_COUNT = 2;
export const RECENT_CHARS = 60;

export const REPLY = Object.freeze({
  answer: '我不能直接给答案。说说你现在做到哪一步、卡在哪里，我给你下一条提示。',
  inject: '这个我帮不了。问跟这道题有关的吧。',
});

// 索答
export const ANSWER = Object.freeze([
  // 直接给我答案 / 直接给答案吧 / 直接发出代码（宾语紧跟；后面接"哪里 / 有问题 / 为什么 / 怎么"是在问错处，不算；"直接给变量赋值的代码报错"不算）
  /直接(给|发)(我|出)?(答案|代码|程序)(?!哪|里|有|错|的?问题|为什么|怎么)/,
  // 给我完整代码 / 我要全部的程序 / 发一份所有答案（前面要有索要的动词；"这题要写完整的程序吗""给我看看完整代码哪里错"不算）
  /(给我写|帮我写|给|发|贴|生成|提供|来|求|我要|想要)(我|一下|一份|一个|个|份|下|出|你|看){0,3}(完整|全部|所有)的?(代码|程序|答案)(?!哪|里|有|错|的?问题|为什么|怎么)/,
  // 整句就是"完整代码""全部答案"（紧凑视图）
  /^(完整|全部|所有)的?(代码|程序|答案)(给我|发我|吧)?$/,
  // 帮我写完 / 帮我把这个函数做完
  /帮我(把.{1,6}?)?(写|做)完/,
  // 把答案发给我 / 把完整代码发我 / 把程序给我看：只认"给我 / 发我 / 发给我 / 给我看"结尾，后面不跟"了 / 吗 / 之后 / 然后 / 看看 / 你"，
  //   句首不是"我（已经 / 刚）把"——"我把代码写出来了，但运行报错""把程序写出来之后要运行吗"是在说自己的进度，不算；
  //   "帮我把答案发给我"的"我"前面是"帮 / 替 / 给 / 让 / 叫"，照样算
  /(?<!(?:^|[^帮替给让叫])我(?:已经|刚才|刚)?)把(完整|全部|所有|正确|标准)?的?(答案|代码|程序)(给我看|发给我|给我|发我)(?!了|吗|之后|然后|看看|你)/,
  // 写出能通过所有测试的代码 / 生成可以通过测试的程序
  /(写出|给出|生成).{0,10}?(能|可以)?通过(全部|所有)?(的)?测试.{0,4}?(代码|程序)/,
  /(full|complete)\s*(solution|code)/,
  // 告诉我答案 / 给我标准答案（"告诉我答案为什么是 3""程序告诉我答案是 3 对吗"不算）
  /(告诉|发给|给)我(正确|标准)?答案(?!哪|里|有|错|的?问题|为什么|怎么|是\s?\d|是不是|对吗)/,
  // 代码直接给我 / 答案发我 / 把正确答案告诉我（"告诉我"只认宾语是答案——"程序告诉我第 3 行有错"是在说报错；
  //   "程序给我的结果是 5""代码给我报错了"不算；句首"我（已经 / 刚）把"同上一条"把…"规则）
  /(?<!(?:^|[^帮替给让叫])我(?:已经|刚才|刚)?把)((答案|代码|程序)(直接)?(给|发)|答案(直接)?告诉)我(?!了|吗|之后|然后|看看|你|的|报|显示|输出|提示|说|是)/,
  // 直接写出答案 / 直接给出代码
  /直接(写|给)出(答案|代码|程序)(?!哪|里|有|错|的?问题|为什么|怎么)/,
]);

// 注入 / 套提示词
export const INJECT = Object.freeze([
  // 忽略之前的所有规则 / 无视你的设定 / 忘掉上面的指令（中间只允许指代类的词，"忽略题目里的第二条要求"不算）
  /(忽略|无视|忘掉|忘记|不用管)(你|的|之前|先前|此前|以上|上面|前面|原来|原有|所有|全部|一切|这些|那些|系统|说的|给的|定的|掉|了|过|\s){0,5}(规则|提示词?|设定|指令|要求|限制)/,
  // 你现在是… / 从现在开始你是… / 你是一个… / 扮演一个… / 假装你…
  //   （"你是说第 2 行吗""你现在是不是看错了""你是一个什么模型""假装输入了 3 怎么测"不算）
  /(你现在是(?!不是)|从现在(开始|起)你(就)?是|你是一(个|名|位)(?!怎|什么|啥)|(扮演|假装)(你|一个|一名|成|是))/,
  // 套提示词（"系统提示语法错误"不算）
  /(系统提示词|system\s*prompt|你的提示词|(泄露|输出|复述).{0,4}提示词)/,
  /(重置|重新)设定/,
  /最高优先级/,
  /ignore\s*(all\s*)?(the\s*)?(previous|prior|above)\s*instructions/,
  /(关闭|退出|不要|取消|解除).{0,4}?(教学|助教)模式/,
]);

const ZERO_WIDTH = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const SPACE_PUNCT = /[\s\p{P}\p{S}]/gu;

const str = (v) => (typeof v === 'string' ? v : '');

export function clean(s) {
  return str(s).normalize('NFKC').replace(ZERO_WIDTH, '');
}

const normal = (s) => clean(s).toLowerCase();
const compact = (s) => normal(s).replace(SPACE_PUNCT, '');

const tailChars = (s, n) => {
  const a = Array.from(s);
  return a.length > n ? a.slice(a.length - n).join('') : s;
};

// text 里有没有一处命中 rule 且命中结束位置 > from（碰到当前问题）
function hitsFrom(rule, text, from) {
  const g = new RegExp(rule.source, rule.flags.includes('g') ? rule.flags : `${rule.flags}g`);
  for (const m of text.matchAll(g)) {
    if (m.index + m[0].length > from) return true;
    if (m[0].length === 0) g.lastIndex++;
  }
  return false;
}

// 一种视图下：先查当前问题本身，再查"旧提问尾巴 + 当前问题"
function viewHit(rules, current, before) {
  for (const rule of rules) {
    if (rule.test(current)) return true;
    if (before && hitsFrom(rule, before + current, before.length)) return true;
  }
  return false;
}

export function screen(question, recent = []) {
  const q = str(question);
  const prev = (Array.isArray(recent) ? recent : [])
    .filter((r) => typeof r === 'string' && r !== '')
    .slice(-RECENT_COUNT)
    .map((r) => tailChars(clean(r), RECENT_CHARS));
  for (const [hit, rules] of [['inject', INJECT], ['answer', ANSWER]]) {
    const n = normal(q);
    const c = compact(q);
    const beforeN = prev.map(normal).join('');
    const beforeC = prev.map(compact).join('');
    if (n && viewHit(rules, n, beforeN)) return { hit };
    if (c && viewHit(rules, c, beforeC)) return { hit };
  }
  return { hit: null };
}
