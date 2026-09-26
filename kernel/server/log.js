// createLog(prefix) → { info, warn, error }，各为 (msg, extra?)；输出 `[prefix] msg`，extra 以 JSON 追加
function fmt(prefix, msg, extra) {
  const head = `[${prefix}] ${msg}`;
  if (extra === undefined) return head;
  let tail;
  try {
    tail = JSON.stringify(extra);
  } catch {
    tail = String(extra);
  }
  return `${head} ${tail}`;
}

export function createLog(prefix) {
  return {
    info: (msg, extra) => console.log(fmt(prefix, msg, extra)),
    warn: (msg, extra) => console.warn(fmt(prefix, msg, extra)),
    error: (msg, extra) => console.error(fmt(prefix, msg, extra)),
  };
}
