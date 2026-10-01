// 课程 id 生成（M4 工作台"新建课程"只填课名，id 由服务端定）：
//   slugFromTitle(title) → 课名里的英文字母与数字转小写、其余连成一个连字符；须以字母开头、3–20 个字符、不是保留字，否则 null
//     （中文转拼音需要字表或依赖，不做；纯中文课名走日期序号）
//   dateSeqId(date, n) → lesson-<yyyyMMdd>-<两位序号>
//   pickLessonId({ title, taken(id) → bool, now }) → 先试 slug，重名或没有就用日期序号（01 起找第一个没被占用的）
// 结果都符合阶段 id 规则 /^[a-z][a-z0-9-]*$/（newLesson 会再校验一次）
import { STAGE_ID_RE, RESERVED_STAGE_IDS } from '../../kernel/server/stage-loader.js';

const MAX_LEN = 20;
const MIN_LEN = 3;
const pad = (n) => String(n).padStart(2, '0');

export function slugFromTitle(title) {
  let s = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '') // 须以字母开头：去掉开头的数字与连字符
    .replace(/-+$/, '');
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN).replace(/-+$/, '');
  if (s.length < MIN_LEN || !STAGE_ID_RE.test(s) || RESERVED_STAGE_IDS.includes(s)) return null;
  return s;
}

export function dateSeqId(date, n) {
  const d = date instanceof Date ? date : new Date(date);
  return `lesson-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(n)}`;
}

export function pickLessonId({ title, taken = () => false, now = new Date() } = {}) {
  const slug = slugFromTitle(title);
  if (slug && !taken(slug)) return slug;
  for (let n = 1; n <= 99; n += 1) {
    const id = dateSeqId(now, n);
    if (!taken(id)) return id;
  }
  throw Object.assign(new Error('今天新建的课程太多了，请明天再建，或先删掉几门不用的课'), { status: 409, expose: true });
}
