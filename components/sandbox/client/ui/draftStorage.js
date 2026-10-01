// PyRunner 刷新保留（规格 §3.4）：localStorage 键 sandbox:<lessonId>:<classEpoch>:<name>:<stageId>
// 值 { code, last: { code(运行时的代码，S3), stdout(尾 20 KB), error, images(≤ 1 张), tests, interrupted, ms(S3), at } }；
// 读写一律 try/catch（隐私模式 / 配额满时静默失败）
// P3：last.tests 带 cases（记录形状 [{ name, ok, reason }]，见 testReport.js），刷新后测试面板照样显示用例
// P6（代码段教学功能规格 §4.2）：code 原语双起始代码——学生选的那份起点的 label 记在 starterKey（= draftKey + ':starter'），
//   readStarter / writeStarter(key, null 即删)；clearDraft(key) 删一个草稿键（"换起点"用）；classroom:reset 时 clearLessonDrafts 按前缀一并清掉
// P7（教师现场演示规格 §5）：学生"换成这份"采用教师下发的代码后，记下那次下发的 at：键 pushed:<lessonId>:<classEpoch>:<name>:<stageId>，
//   readPushed(key) → 数字或 null；writePushed(key, at)（null 即删）。键含 classEpoch，课堂重置后自然换键（不在 sandbox: 前缀下，不随草稿清）
import { reportCases } from './testReport.js';
const STDOUT_TAIL = 20 * 1024;
const TRACEBACK_MAX = 4000;

export function draftKey({ lessonId, classEpoch, name, stageId }) {
  if (!lessonId || !name || !stageId) return null;
  return `sandbox:${lessonId}:${classEpoch ?? null}:${name}:${stageId}`;
}

// "换起点"之后、还没选新起点时写进起点键的标记（P6 审查 S3）：不是合法 label（含控制字符，code 原语校验 label 时拒绝控制字符）
export const STARTER_PENDING = '\u0000pending';

// 起点选择键：draftKey + ':starter'（与草稿同前缀，重置时一起清）
export function starterKey(args) {
  const k = draftKey(args ?? {});
  return k ? `${k}:starter` : null;
}

export function readStarter(key) {
  if (!key) return null;
  try {
    const v = globalThis.localStorage?.getItem(key);
    return typeof v === 'string' && v !== '' ? v : null;
  } catch {
    return null;
  }
}

// label 为 null / 空串时删掉
export function writeStarter(key, label) {
  if (!key) return;
  try {
    if (typeof label === 'string' && label !== '') globalThis.localStorage?.setItem(key, label);
    else globalThis.localStorage?.removeItem(key);
  } catch {
    // 忽略
  }
}

// P7：教师下发的采用标记
export function pushedKey({ lessonId, classEpoch, name, stageId } = {}) {
  if (!lessonId || !name || !stageId) return null;
  return `pushed:${lessonId}:${classEpoch ?? null}:${name}:${stageId}`;
}

export function readPushed(key) {
  if (!key) return null;
  try {
    const v = globalThis.localStorage?.getItem(key);
    const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writePushed(key, at) {
  if (!key) return;
  try {
    if (typeof at === 'number' && Number.isFinite(at)) globalThis.localStorage?.setItem(key, String(at));
    else globalThis.localStorage?.removeItem(key);
  } catch {
    // 忽略
  }
}

export function clearDraft(key) {
  if (!key) return;
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // 忽略
  }
}

export function readDraft(key) {
  if (!key) return null;
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function writeDraft(key, value) {
  if (!key) return;
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // 配额满 / 不可用：忽略
  }
}

// 清掉本课全部草稿键（classroom:reset）
export function clearLessonDrafts(lessonId) {
  if (!lessonId) return;
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    const prefix = `sandbox:${lessonId}:`;
    const keys = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) ls.removeItem(k);
  } catch {
    // 忽略
  }
}

const tail = (s, n) => (typeof s === 'string' ? (s.length > n ? s.slice(s.length - n) : s) : '');
const counts = (t) => {
  if (!t) return null;
  const out = { passed: t.passed ?? 0, failed: t.failed ?? 0, errors: t.errors ?? 0, total: t.total ?? 0 };
  const cases = reportCases(t);
  if (cases) out.cases = cases;
  return out;
};
const msOf = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

// RunResult → last
export function lastOfRun(r, now = Date.now()) {
  const e = r?.error;
  const img = Array.isArray(r?.imagesCompact) ? r.imagesCompact[0] : null;
  return {
    stdout: tail(r?.stdout, STDOUT_TAIL),
    error: e ? { type: e.type, message: e.message ?? '', traceback: String(e.traceback ?? '').slice(0, TRACEBACK_MAX), hint: e.hint ?? null } : null,
    images: typeof img === 'string' && img ? [img] : [],
    tests: null,
    interrupted: !!r?.interrupted,
    ms: msOf(r?.ms),
    at: now,
  };
}

// TestResult → last
export function lastOfTest(t, now = Date.now()) {
  return { stdout: tail(t?.stdout, STDOUT_TAIL), error: null, images: [], tests: counts(t), interrupted: !!t?.interrupted, ms: msOf(t?.ms), at: now };
}

// S3：localStorage 里的 last → 交给阶段 onRestore 的结果摘要（RunResult 形状，可直接 buildRecord；测试结果另带 tests 四个计数）
// { kind:'run'|'test', ok, value:null, error, stdout, stderr:'', images, imagesCompact, ms, interrupted, tests, restored:true }
export function resultOfLast(last) {
  if (!last || typeof last !== 'object') return null;
  const e = last.error && typeof last.error === 'object' && last.error.type ? last.error : null;
  const error = e ? { type: String(e.type), message: String(e.message ?? ''), traceback: String(e.traceback ?? ''), hint: e.hint ?? null } : null;
  const images = Array.isArray(last.images) ? last.images.filter((s) => typeof s === 'string' && s).slice(0, 1) : [];
  const tests = last.tests && typeof last.tests === 'object' ? counts(last.tests) : null;
  const interrupted = !!last.interrupted;
  const ok = tests
    ? !interrupted && tests.total > 0 && tests.failed === 0 && tests.errors === 0
    : !interrupted && !error;
  return {
    kind: tests ? 'test' : 'run',
    ok,
    value: null,
    error,
    stdout: typeof last.stdout === 'string' ? last.stdout : '',
    stderr: '',
    images,
    imagesCompact: images.slice(),
    ms: msOf(last.ms),
    interrupted,
    tests,
    restored: true,
  };
}
