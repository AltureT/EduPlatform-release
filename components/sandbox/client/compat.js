// 浏览器兼容检查（规格 §1 运行环境前提；S3）：加载 Pyodide 前判断，不满足时 pythonClient 直接进 failed 并给一句明确提示，
// 而不是含糊的 init 失败。需要 WebAssembly、模块 Worker、BigInt、crypto.getRandomValues（下限 Chrome / Edge ≥ 85、Safari ≥ 15）；
// Chromium 内核另按 UA 要求 ≥ 85；Safari 14 及以下没有模块 Worker，由探测判出
// checkBrowser(env = globalThis) → { ok, reason }：reason 为缺失项（调试用，不给学生看）；学生看到的是 UNSUPPORTED_MESSAGE
export const UNSUPPORTED_MESSAGE = '这台电脑的浏览器太旧，请换 Chrome 或 Edge（85 以上）；iPad 请把系统升级到 15 以上';
export const MIN_CHROMIUM = 85;

export const isUnsupportedError = (message) => message === UNSUPPORTED_MESSAGE;

// 模块 Worker：用空脚本的 blob URL 建一个 Worker，WorkerOptions 的 type 被读取即说明认识 { type:'module' }；建好立即终止。
// 构造抛错（例如将来页面 CSP 不许 blob: Worker）不直接判否：options 在抛错前已被读取，以探测到的结果为准
function moduleWorkerOk(env) {
  const W = env.Worker;
  const U = env.URL;
  const B = env.Blob;
  if (typeof W !== 'function' || typeof B !== 'function' || typeof U?.createObjectURL !== 'function') return false;
  let url = null;
  let w = null;
  let read = false;
  try {
    url = U.createObjectURL(new B([''], { type: 'text/javascript' }));
    w = new W(url, {
      get type() {
        read = true;
        return 'module';
      },
    });
  } catch {
    // 以 read 为准（见上）
  } finally {
    try {
      w?.terminate?.();
    } catch {
      // 忽略
    }
    try {
      if (url) U.revokeObjectURL?.(url);
    } catch {
      // 忽略
    }
  }
  return read;
}

// Chromium 内核（Chrome / 新 Edge / 国产双核浏览器的极速模式）的主版本号；不是 Chromium 返回 null
export function chromiumMajor(ua) {
  const m = /(?:Chrome|Chromium)\/(\d+)/.exec(String(ua ?? ''));
  return m ? Number(m[1]) : null;
}

export function checkBrowser(env = globalThis) {
  const e = env ?? {};
  if (typeof e.WebAssembly !== 'object' || e.WebAssembly === null || typeof e.WebAssembly.instantiate !== 'function') {
    return { ok: false, reason: 'WebAssembly' };
  }
  if (typeof e.BigInt !== 'function') return { ok: false, reason: 'BigInt' };
  if (typeof e.crypto?.getRandomValues !== 'function') return { ok: false, reason: 'crypto.getRandomValues' };
  const major = chromiumMajor(e.navigator?.userAgent);
  if (major != null && major < MIN_CHROMIUM) return { ok: false, reason: `Chromium ${major} < ${MIN_CHROMIUM}` };
  if (!moduleWorkerOk(e)) return { ok: false, reason: 'module Worker' };
  return { ok: true, reason: null };
}
