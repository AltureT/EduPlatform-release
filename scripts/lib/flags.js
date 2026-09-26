// new:lesson / new:stage 的命令行参数：--key value、--key=value、布尔开关；未知参数或缺值抛错（文案面向 AI）
//   parseFlags(argv, { values: ['id', …], booleans: ['no-env', …] }) → { id, …, 'no-env': true }
export function parseFlags(argv, { values = [], booleans = [] } = {}) {
  const out = {};
  const args = [...argv];
  while (args.length) {
    let a = args.shift();
    let inline;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const name = a.replace(/^--/, '');
    if (!a.startsWith('--') || (!values.includes(name) && !booleans.includes(name))) {
      const known = [...values.map((v) => `--${v} <值>`), ...booleans.map((b) => `--${b}`)].join(' ');
      throw new Error(`不认识的参数 ${a}（可用：${known}）`);
    }
    if (booleans.includes(name)) {
      out[name] = true;
      continue;
    }
    const v = inline ?? args.shift();
    if (v === undefined || v === '' || (inline === undefined && v.startsWith('--'))) throw new Error(`参数 --${name} 缺少值`);
    out[name] = v;
  }
  return out;
}
