// sandbox:s-status 的计数与发送（规格 §3.2a、§3.7）：studentOverlay 是唯一发送方
// - 就绪级别：none 未加载；core 核心 + lesson 级包就绪；stage 在 core 基础上本阶段 packages / flask / files 也就绪；prelogin 最高 core
// - 按阶段计数 runs / errors / lastError / lastRunAt / tests；当前阶段变化时清零
// - start() 立即发一次；其余变化 1 s 内合并，定时器触发时重新读取当前阶段再发（推进后不会发出旧 stageId）
// - lastError：最近一次运行的异常"类型: 首行消息"（≤ 200 字符）；之后一次成功运行会清掉（被停止不清），供教师看"最近出错"
// 页面级状态放在模块里（studentOverlay 断线重连时会卸载重挂，计数与就绪标记不丢）；模块顶层无副作用

const MERGE_MS = 1000;
const LAST_ERROR_MAX = 200;

function freshPage() {
  return { counts: null, coreDone: false, stageDone: new Set() };
}
let page = freshPage();

export function pageState() {
  return page;
}

// classroom:reset 时清计数（就绪标记描述的是本页运行环境，保留）
export function resetPageCounts() {
  page.counts = null;
}

export function __resetStatusForTest() {
  page = freshPage();
}

export function readyLevel({ status, phase, coreDone, stageDone, stageId, hasConfig }) {
  if (status === 'idle' || status === 'failed') return 'none';
  if (status === 'loading' && (phase === 'core' || phase === 'restart')) return 'none';
  if (!coreDone) return 'none';
  if (stageId === 'prelogin' || !hasConfig) return 'core';
  return stageDone ? 'stage' : 'core';
}

export function errorSummary(error) {
  if (!error || !error.type) return undefined;
  const first = String(error.message ?? '').split('\n')[0].trim();
  const s = first ? `${error.type}: ${first}` : String(error.type);
  return s.slice(0, LAST_ERROR_MAX);
}

const count = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(100000, Math.max(0, n)) : 0;
};

export function createStatusReporter({
  send, getStageId, getReady, store = page, now = () => Date.now(),
  setTimeout: st = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: ct = (t) => globalThis.clearTimeout(t), mergeMs = MERGE_MS,
}) {
  let timer = null;
  const countsFor = (stageId) => {
    if (!store.counts || store.counts.stageId !== stageId) {
      store.counts = { stageId, runs: 0, errors: 0, lastError: undefined, lastRunAt: undefined, tests: undefined };
    }
    return store.counts;
  };

  function payload() {
    const stageId = getStageId();
    const c = countsFor(stageId);
    const p = { stageId, ready: getReady(stageId), runs: count(c.runs), errors: count(c.errors) };
    if (c.lastError) p.lastError = c.lastError;
    if (c.lastRunAt != null) p.lastRunAt = c.lastRunAt;
    if (c.tests) p.tests = c.tests;
    return p;
  }

  function sendNow() {
    if (timer) ct(timer);
    timer = null;
    try {
      send('sandbox:s-status', payload());
    } catch (e) {
      console.warn('[sandbox] s-status 发送失败', e);
    }
  }

  function schedule() {
    if (timer) return;
    timer = st(() => {
      timer = null;
      sendNow();
    }, mergeMs);
  }

  return {
    start: sendNow,
    runEnd(ev) {
      const c = countsFor(getStageId());
      c.runs += 1;
      c.lastRunAt = Math.round(now());
      if (ev?.kind === 'test') {
        if (!ev.interrupted && ev.tests) {
          c.tests = { passed: count(ev.tests.passed), failed: count(ev.tests.failed), errors: count(ev.tests.errors), total: count(ev.tests.total) };
        }
      } else if (ev?.error) {
        c.errors += 1;
        c.lastError = errorSummary(ev.error);
      } else if (!ev?.interrupted) {
        c.lastError = undefined;
      }
      schedule();
    },
    readyChanged: schedule,
    stageChanged() {
      countsFor(getStageId());
      schedule();
    },
    dispose() {
      if (timer) ct(timer);
      timer = null;
    },
  };
}
