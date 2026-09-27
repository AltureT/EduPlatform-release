// coach："像代码"的一行（coach 组件规格 §12.4）。纯模块、不引 Node：服务端 prompt.js（sanitize 的代码行额度与连续代码判定）
// 与客户端 client.jsx（回答里的代码行用 <CodeView> 高亮，代码展示统一高亮规格 §4）共用同一个正则。
export const CODE_LINE = /^\s*(def |class |for .+:|while .+:|if .+:|elif |else:|import |from .+ import|print\(|return |\w+(\[.+\])?\s*=\s*[^=])/;

// 回答按行分段（U6）：连续的 CODE_LINE 行并成一段 { code: true, text }，其余连续行并成 { code: false, text }（空段不出）。
// 空行不算代码行（会断开代码段）。sanitize 已去掉围栏标记，存下来的回答里代码就是这样的裸行。
export function codeSegments(text) {
  const segs = [];
  for (const line of String(text ?? '').split('\n')) {
    const code = CODE_LINE.test(line);
    const last = segs[segs.length - 1];
    if (last && last.code === code) last.lines.push(line);
    else segs.push({ code, lines: [line] });
  }
  return segs
    .map(({ code, lines }) => ({ code, text: lines.join('\n') }))
    .filter((s) => s.text !== '');
}
