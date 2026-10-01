#!/usr/bin/env node
// npm run prep:tests -- <段目录> [--json]（代码题批改规格 §3.2、§4.2、§5）：备课时把"判断"做完，上课只做匹配。
//   有 hidden.json → 用参考答案算每条隐藏用例的结果哈希，写 tests/test_hidden.py（有 brute.py 时同时对拍）；
//   有 mistakes/ → 每个错误版本跑全部测试（含隐藏用例），记失败用例名，写 mistakes.json。
//   参考答案：code 段 options.solution，自写段本段目录 solution.py（同 check:lesson 第 14 关）。
//   退出码：0 成功；1 没有参考答案 / 形状错 / 求值出错；2 Python 运行时不可用；3 参考答案与笨办法解不一致；4 错误版本没被抓住或两个版本分不开
//   （同时有几种时取 2 > 1 > 3 > 4）。文件照写（3、4 时也写）；同样的输入重跑结果不变。
//   --json：{ hidden: [{ name, ok, hash?, error? }], mistakes: [{ id, label, failing }], disagree: [name], exit }
// 程序接口：prepTests(stageDir, { runner?, root?, log? }) → { exit, report, lines }（runner 可注入假运行器，单测用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FROM_MAX_BYTES } from '../kernel/server/stage-loader.js';
import { createPyRunner, NOT_DOWNLOADED } from './lib/pyrun-node.js';
import {
  HIDDEN_JSON, HIDDEN_FILE, HIDDEN_PATH, MISTAKES_DIR, MISTAKES_JSON, BRUTE_FILE, MISTAKES_MAX,
  parseHidden, renderHiddenTests, parseMistakeFile, renderMistakesJson, mistakeIssues, computeHidden, computeMistakes, listedLine,
} from './lib/hidden-tests.js';

export const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWNLOAD = '先在工作台左边第 4 步"上课准备"的"Python 运行时"一节点"下载 Python 运行时"（约 40 MB，需要联网），再跑一次 npm run prep:tests';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readText = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};
const hasCode = (src) => typeof src === 'string' && src.split('\n').some((l) => l.trim() !== '' && !l.trim().startsWith('#'));
// 写文件：内容相同就不动（重跑不改 mtime）
function writeIfChanged(file, text) {
  if (readText(file) === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

// { from } 读取器：与加载器 kernel/server/stage-loader.js 的 createReaders 同一套规则（那里没有导出，这里照写）——
//   相对阶段目录；真实路径（跟随软链）必须在阶段根目录（阶段目录的上一级，即 lesson.config 的 stagesDir）内；
//   单文件与合计 ≤ FROM_MAX_BYTES（256 KB）；越界、超限、不存在都抛错（prep 退出 1）
const kb = (n) => Math.ceil(n / 1024);
const realOrSelf = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const within = (root, p) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
export function createRefReader(stageDir, stagesRoot = path.dirname(path.resolve(stageDir))) {
  let total = 0;
  const root = realOrSelf(stagesRoot);
  return (v) => {
    if (typeof v === 'string') return v;
    if (!(isPlainObject(v) && typeof v.from === 'string' && Object.keys(v).length === 1)) {
      throw new Error(`文件引用必须是 { from: '相对路径' }（得到 ${JSON.stringify(v)}）`);
    }
    const rel = v.from;
    const abs = path.resolve(stageDir, rel);
    if (!within(root, realOrSelf(abs))) {
      throw new Error(`${rel} 不在阶段根目录（${stagesRoot}）内（按真实路径判断，软链也算），只能引用阶段根目录里的文件`);
    }
    let size;
    try {
      size = fs.statSync(abs).size;
    } catch {
      throw new Error(`读取 ${rel} 失败：文件不存在（${abs}）`);
    }
    if (size > FROM_MAX_BYTES) throw new Error(`${rel} 有 ${kb(size)} KB，超过 ${kb(FROM_MAX_BYTES)} KB`);
    total += size;
    if (total > FROM_MAX_BYTES) throw new Error(`引用的文件合计 ${kb(total)} KB，超过 ${kb(FROM_MAX_BYTES)} KB（读到 ${rel} 时）`);
    return fs.readFileSync(abs, 'utf8');
  };
}

// 读本段：不走完整加载器（tests 里先列了还没生成的 test_hidden.py 时加载器会失败），只取测试、答案、数据文件
export async function readStage(stageDir) {
  const cfgFile = path.join(stageDir, 'stage.config.js');
  if (!fs.existsSync(cfgFile)) throw new Error(`${stageDir} 里没有 stage.config.js`);
  const stat = fs.statSync(cfgFile);
  const mod = await import(`${pathToFileURL(cfgFile).href}?t=${stat.mtimeMs}`);
  const config = mod.default ?? {};
  const isPrimitive = config.primitive != null;
  const refText = createRefReader(stageDir);
  const src = isPrimitive ? (isPlainObject(config.options) ? config.options : {}) : (isPlainObject(config.sandbox) ? config.sandbox : {});
  const tests = {};
  let listed = false;
  for (const [name, v] of Object.entries(isPlainObject(src.tests) ? src.tests : {})) {
    if (name === HIDDEN_FILE) {
      listed = true;
      continue;
    }
    tests[name] = refText(v);
  }
  const files = {};
  for (const [p, v] of Object.entries(isPlainObject(src.files) ? src.files : {})) {
    files[p] = refText(v);
  }
  const solution = isPrimitive
    ? (src.solution !== undefined ? refText(src.solution) : null)
    : readText(path.join(stageDir, 'solution.py'));
  return { id: config.id ?? path.basename(stageDir), isPrimitive, tests, files, solution, listed };
}

export async function prepTests(stageDir, { runner: injected, root = PLATFORM_ROOT, log = () => {} } = {}) {
  const lines = [];
  const say = (l) => {
    lines.push(l);
    log(l);
  };
  const report = { hidden: [], mistakes: [], disagree: [] };
  const codes = new Set();
  const finish = () => {
    const exit = [2, 1, 3, 4].find((c) => codes.has(c)) ?? 0;
    return { exit, report: { ...report, exit }, lines };
  };
  const t0 = Date.now();

  let stage;
  try {
    stage = await readStage(stageDir);
  } catch (err) {
    say(`读不了这一段：${String(err?.message ?? err).split('\n')[0]}`);
    codes.add(1);
    return finish();
  }
  const at = (f) => path.join(stageDir, f);
  const hiddenText = readText(at(HIDDEN_JSON));
  const mistakesDir = at(MISTAKES_DIR);
  const hasMistakes = fs.existsSync(mistakesDir) && fs.statSync(mistakesDir).isDirectory();
  if (hiddenText == null && !hasMistakes) {
    say(`这一段没有 ${HIDDEN_JSON}，也没有 ${MISTAKES_DIR}/，没什么要生成的`);
    return finish();
  }
  if (!hasCode(stage.solution)) {
    say(stage.isPrimitive
      ? "没有参考答案：在 options 里写 solution: { from: './solution.py' } 再跑"
      : '没有参考答案：在本段目录放 solution.py 再跑');
    codes.add(1);
    return finish();
  }

  // 形状先查（不起 Python）
  let hidden = null;
  if (hiddenText != null) {
    try {
      hidden = parseHidden(hiddenText);
    } catch (err) {
      say(`${HIDDEN_JSON} 写得不对：${err.message}`);
      codes.add(1);
    }
  }
  let mistakes = null;
  if (hasMistakes) {
    const names = fs.readdirSync(mistakesDir).filter((f) => f.endsWith('.py')).sort();
    if (names.length > MISTAKES_MAX) {
      say(`${MISTAKES_DIR}/ 最多 ${MISTAKES_MAX} 个错误版本，现在 ${names.length} 个`);
      codes.add(1);
    } else {
      try {
        mistakes = names.map((f) => parseMistakeFile(f, readText(path.join(mistakesDir, f))));
      } catch (err) {
        say(err.message);
        codes.add(1);
      }
    }
  }
  if (!hidden && !mistakes) return finish();

  const runner = injected ?? createPyRunner({ root });
  try {
    if (!runner.available) {
      say(`${String(runner.reason ?? NOT_DOWNLOADED).replace(/（[^）]*）$/, '')}：${DOWNLOAD}`);
      codes.add(2);
      return finish();
    }
    const tests = { ...stage.tests };
    // 1 隐藏用例
    if (hidden) {
      say(`隐藏用例：${hidden.length} 条，用参考答案求值…`);
      const res = await computeHidden(runner, stage.solution, hidden, { files: stage.files });
      report.hidden = res.map((r) => (r.ok ? { name: r.name, ok: true, hash: r.hash } : { name: r.name, ok: false, error: r.error }));
      for (const r of res.filter((x) => !x.ok)) {
        say(`  求值出错（这条没写）：${r.name}——${r.error}`);
        codes.add(1);
      }
      const text = renderHiddenTests(hidden, res.map((r) => (r.ok ? r.hash : null)));
      const changed = writeIfChanged(at(HIDDEN_PATH), text);
      say(`${changed ? '已写' : '没有变化'} ${HIDDEN_PATH}（${res.filter((r) => r.ok).length} 条）`);
      tests[HIDDEN_FILE] = text;
      // 对拍
      const brute = readText(at(BRUTE_FILE));
      if (brute != null) {
        const b = await computeHidden(runner, brute, hidden, { files: stage.files });
        report.disagree = hidden.filter((c, i) => res[i].ok && (!b[i].ok || b[i].repr !== res[i].repr)).map((c) => c.name);
        if (report.disagree.length > 0) {
          for (const n of report.disagree) say(`参考答案与笨办法解不一致：${n}`);
          codes.add(3);
        } else say(`对拍：${BRUTE_FILE} 与参考答案在隐藏用例上一致`);
      }
      if (!stage.listed) say(`还要把它列进测试：${listedLine(stage.isPrimitive)}`);
    }
    // 2 错误库
    if (mistakes) {
      say(`错误库：${mistakes.length} 个错误版本，逐个跑测试${hidden ? '（含隐藏用例）' : ''}…`);
      if (!stage.isPrimitive) say('自写段不做错误库匹配，只用它检查测试强度（照常生成 mistakes.json）');
      let m = null;
      try {
        m = await computeMistakes(runner, { solution: stage.solution, tests, files: stage.files, mistakes });
      } catch (err) {
        if (!err?.solutionFailed) throw err;
        say(`参考答案没通过测试，错误库没法生成：先跑 npm run check:lesson 看是哪条`);
        codes.add(1);
      }
      if (m) {
        report.mistakes = m.mistakes.map((x) => ({ id: x.id, label: x.label, failing: x.failing }));
        for (const x of m.mistakes) say(`  ${x.id}（${x.label}）：失败 ${x.failing.length} 条${x.failing.length ? `——${x.failing.join('、')}` : ''}`);
        const changed = writeIfChanged(at(MISTAKES_JSON), renderMistakesJson(m));
        say(`${changed ? '已写' : '没有变化'} ${MISTAKES_JSON}`);
        const { uncaught, same } = mistakeIssues(m.mistakes);
        const label = (id) => m.mistakes.find((x) => x.id === id)?.label ?? id;
        for (const id of uncaught) say(`错误版本 ${label(id)} 没被测试抓住，补用例`);
        for (const [a, b] of same) say(`${label(a)} 与 ${label(b)} 失败用例一样，上课分不开`);
        if (uncaught.length > 0 || same.length > 0) codes.add(4);
      }
    }
  } finally {
    if (!injected) await runner.close?.();
  }
  say(`完成（用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
  return finish();
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = (l) => console.log(l), runner } = {}) {
  const json = argv.includes('--json');
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) {
    log('用法：npm run prep:tests -- <段目录>（如 lessons/<课>/stages/03-code）[--json]');
    return 1;
  }
  const dir = path.resolve(cwd, target);
  if (!json) log(`prep:tests ${target}`);
  const r = await prepTests(dir, { runner, log: json ? () => {} : log });
  if (json) log(JSON.stringify(r.report, null, 2));
  return r.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.log(`prep:tests 没能完成：${String(err?.message ?? err).split('\n')[0]}`);
    process.exitCode = 1;
  });
}
