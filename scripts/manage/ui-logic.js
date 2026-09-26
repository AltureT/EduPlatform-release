// 管理台页面逻辑里的纯函数（M2、M3）：页面 public/app.js 以 ES module 从 /ui-logic.js 引入；测试直接 import（__tests__/ui-logic.test.js）
// 只用浏览器与 Node 都有的标准 API，不依赖 DOM
//   guideSteps(overview) → { steps: [{ id, n, title, inline, done, current, clickable, summary, busy?, fetching? }], currentId, allDone }：
//     M3 首页向导（未运行时）；inline = 'password' | 'lesson' | 'pyodide' | 'start'，页面按它渲染右侧表单
//   wizardView(g, requested) / stepCounter(g, id)：右侧显示哪一步（只能看已完成或当前步）；窄屏一行"第 N 步 / 共 M 步 · 标题"
//   wizardBackSteps(g, view)：窄屏"改前面的步骤"列出的已完成步骤（M3 审查）
//   passwordError / pyodideStatus / fetchProgress：向导第 1、3 步与设置页
//   errorActions(error) → [{ id, label, title, ... }]：启动失败时可点的下一步（动态按钮都带 title 提示）
//   stateLabel(platform) → 状态带里的状态文字（已停止时区分"没能启动"与"平台意外停止"）
//   backupKind / backupSummary / fmtDate / fmtSize：备份列表"日期 · 大小 · 手动备份还是自动快照"
//   lessonChoices / lessonOptionLabel / lessonOptionTitle / lessonSummary：课程下拉（只显示标题，目录放 title）与"当前课程"
//   pickLesson(choices, current)：下拉默认选哪门（当前课找不到或读不出时选第一门能用的，M3 审查）
//   classroomLesson(overview)：上课面板的课程——平台正在跑的课 + "已换成《…》，重启后生效"（M3 审查）
//   splitAddresses / logTail
//   L1：checkSummary / checkNotice / checkItems / checkReportText：课程检查（check:lesson）的摘要、列表与"复制给 AI"的文本；
//     errorActions 的 'check'（课程有问题，没启动）→ "复制给 AI" + "改好了，再启动"
//   M4：lessonCardStatus / lessonCardMeta / draftNote / lessonCardOps / uploadCheck：课程页卡片（见文件末尾）

const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(t) {
  if (t === null || t === undefined || t === '') return '—';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtSize(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ===== 状态文字 =====
// M3：不出现"端口""页面""构建"；学生地址里自带端口
const STATE_TEXT = {
  stopped: '未启动', building: '正在准备（第一次或换课后要一会儿）…', starting: '正在启动…', running: '运行中', stopping: '正在停止…',
};
export function stateLabel(p) {
  const s = p?.state;
  if (s === 'stopped' && p.error) return p.error.phase === 'running' ? '平台意外停止' : '没能启动';
  return STATE_TEXT[s] || s || '';
}

// ===== 首页向导（M3） =====
const BUSY = new Set(['building', 'starting', 'stopping']);

export function guideSteps(o) {
  const state = o?.platform?.state;
  const running = state === 'running';
  const setup = o?.setup ?? {};
  const py = o?.pyodide ?? {};
  const ls = lessonSummary(o?.lesson);
  const steps = [
    { id: 'password', inline: 'password', title: '设置教师密码', done: Boolean(setup.passwordSet), summary: setup.passwordSet ? '已设置' : '' },
    {
      id: 'lesson', inline: 'lesson', title: '选择课程', done: Boolean(setup.lessonChosen),
      summary: setup.lessonChosen ? `当前：《${ls.title}》${ls.meta ? `· ${ls.meta}` : ''}` : '',
    },
  ];
  if (py.needed) {
    steps.push({
      id: 'pyodide', inline: 'pyodide', title: '下载 Python 运行时', done: Boolean(py.ready),
      summary: py.ready ? '已就绪' : '', fetching: Boolean(py.fetching),
    });
  }
  steps.push({ id: 'start', inline: 'start', title: '启动平台', done: running, summary: running ? '运行中' : '', busy: BUSY.has(state) });
  // 运行中即视为全部完成（向导收起，首页换成上课面板）
  let currentId = null;
  const out = steps.map((s, i) => {
    const done = running || s.done;
    const current = !done && currentId === null;
    if (current) currentId = s.id;
    return { ...s, n: i + 1, done, current, clickable: done || current };
  });
  return { steps: out, currentId, allDone: currentId === null };
}

// 右侧显示哪一步：点了已完成的步骤就显示它，否则显示当前步（全部完成时显示最后一步）
export function wizardView(g, requested) {
  const hit = g.steps.find((s) => s.id === requested);
  if (hit?.clickable) return hit.id;
  return g.currentId ?? g.steps.at(-1).id;
}

export function wizardBackSteps(g, view) {
  return g.steps.filter((s) => s.done && s.id !== view);
}

export function stepCounter(g, id) {
  const s = g.steps.find((x) => x.id === id) ?? g.steps[0];
  return `第 ${s.n} 步 / 共 ${g.steps.length} 步 · ${s.title}`;
}

// 与服务端 env-file.js validateSettings 的 TEACHER_PASSWORD 规则一致
export function passwordError(pw) {
  const v = String(pw ?? '');
  if (v.length === 0) return '密码不能为空';
  if (v.length < 6) return '密码至少 6 位';
  if (v.length > 64) return '密码不能超过 64 个字符';
  return null;
}

// Python 运行时：正文只说状态，版本 / 文件数 / 大小放 title 提示
export function pyodideStatus(py = {}) {
  const button = py.ready ? '检查并补全' : '下载 Python 运行时';
  const buttonTitle = py.ready ? '已下载的文件不会重复下载，只补上缺少的' : '约 40 MB，需要联网；中途断网再点一次会接着下载';
  const title = py.ready
    ? `版本 ${py.version ?? '—'} · ${py.fileCount ?? 0} 个文件 · ${fmtSize(py.totalSize)}${py.fetchedAt ? ` · ${fmtDate(py.fetchedAt)} 下载` : ''}`
    : '';
  let label;
  let dot;
  if (py.fetching) [label, dot] = ['正在下载…', 'busy'];
  else if (py.ready) [label, dot] = [py.needed ? '已就绪' : '已就绪（当前课程不需要）', 'good'];
  else [label, dot] = py.needed ? ['未下载（当前课程需要）', 'bad'] : ['当前课程不需要', 'off'];
  return { label, dot, title, button, buttonTitle };
}

// 下载进度：scripts/fetch-pyodide.mjs 没有百分比输出，按它的阶段行估算（核心文件 → 扩展包 → 轮子 → 字体 → 完成）
export function fetchProgress(lines = []) {
  let percent = 2;
  let label = '正在连接…';
  let closure = 0;
  let files = 0;
  for (const l of lines) {
    const pk = /^包闭包 (\d+) 个/.exec(l);
    if (/^Pyodide /.test(l)) [percent, label] = [10, '正在下载核心文件…'];
    else if (pk) {
      closure = Number(pk[1]) || 0;
      files = 0;
      [percent, label] = [35, '正在下载 Python 扩展包…'];
    } else if (/^PyPI 轮子/.test(l)) [percent, label, closure] = [72, '正在下载网页框架…', 0];
    else if (/^字体 /.test(l)) [percent, label] = [85, '正在准备中文字体…'];
    else if (/^✓ 完成/.test(l)) [percent, label] = [100, '下载完成'];
    else if (/^\s+(已下载|已存在)\s/.test(l)) {
      if (closure > 0) {
        files += 1;
        percent = Math.min(71, 35 + Math.round((36 * files) / closure));
      } else if (percent >= 10 && percent < 33) percent += 2;
    }
  }
  return { percent, label };
}

// ===== 启动失败的下一步 =====
const LOG = { id: 'show-log', label: '查看日志', title: '打开最近 500 行运行记录，可以截图发给技术同事' };
const RETRY = { id: 'start', label: '已关掉，重试', title: '已经关掉占用端口的程序后，再启动一次' };
const START = { id: 'start', label: '启动平台', title: '再启动一次平台' };
const OTHER_PORT = { id: 'goto-settings', label: '换一个端口', field: 'PORT', title: '到设置页换一个端口，例如 3001 或 8080' };

export function errorActions(err) {
  if (!err) return [];
  switch (err.kind) {
    case 'password':
      return [{ id: 'goto-settings', label: '去设置密码', field: 'TEACHER_PASSWORD', title: '打开设置页并把光标放进教师密码框' }];
    case 'requires':
      return [{ id: 'fetch-pyodide', label: '下载 Python 运行时', title: '约 40 MB，需要联网；下载完再启动平台' }];
    case 'lesson':
      return [{ id: 'goto-settings', label: '换一门课程', field: 'LESSON_CONFIG', title: '打开设置页的课程下拉框' }];
    case 'check':
      return [
        { id: 'copy-check', label: '复制给 AI', title: '把整份检查结果复制下来，直接贴给帮你生成课程的 AI，让它照着改' },
        { id: 'start', label: '改好了，再启动', title: '课程改好后再启动一次，启动前会重新检查' },
      ];
    case 'crash':
      return err.phase === 'running' ? [LOG, START] : [LOG];
    case 'build':
    case 'timeout':
    case 'internal':
      return [LOG];
    case 'port': {
      const usePort = err.suggestPort
        ? [{
          id: 'use-port', label: `改用 ${err.suggestPort}`, port: err.suggestPort,
          title: `把端口改成 ${err.suggestPort} 并启动平台；学生地址会跟着变`,
        }]
        : [];
      if (err.reason === 'in-use') {
        if (err.owner?.ours) {
          return [{
            id: 'stop-old', label: '停止它并启动', pid: err.owner.pid, confirm: true,
            title: '结束之前没关掉的本平台，再用当前设置启动；正在连接的学生会断开',
          }, ...usePort];
        }
        return [...(usePort.length ? usePort : [OTHER_PORT]), RETRY];
      }
      if (err.reason === 'no-permission') return usePort.length ? usePort : [OTHER_PORT];
      if (err.reason === 'not-ours') return [...(usePort.length ? usePort : [OTHER_PORT]), RETRY];
      return [{ id: 'goto-settings', label: '去改端口', field: 'PORT', title: '到设置页把端口改成 1 到 65535 之间的整数' }];
    }
    default:
      return [];
  }
}

// ===== 备份 =====
export function backupKind(file) {
  if (/^pre_restore_/.test(file)) return { kind: 'auto', label: '恢复前自动快照' };
  if (/^pre_reset_/.test(file)) return { kind: 'auto', label: '重置前自动快照' };
  return { kind: 'manual', label: '手动备份' };
}

export function backupSummary(b) {
  return `${fmtDate(b.mtime)} · ${fmtSize(b.size)} · ${backupKind(b.file).label}`;
}

// ===== 课程 =====
// info：overview.lesson（当前课的读取结果）；当前课不在列表里时据此区分"找不到"与"写坏了读不出来"
export function lessonChoices(list, current, info) {
  const normal = (list || []).filter((l) => !l.dev);
  const dev = (list || []).filter((l) => l.dev);
  const out = [...normal, ...dev];
  if (current && !out.some((l) => l.path === current)) {
    const broken = Boolean(info && info.path === current && info.error && !info.missing);
    out.push({ path: current, title: null, dir: null, ...(broken ? { broken: true } : { missing: true }) });
  }
  return out;
}

export function pickLesson(choices, current) {
  const usable = (l) => !l.missing && !l.broken;
  const cur = choices.find((l) => l.path === current);
  if (cur && usable(cur)) return current;
  return choices.find(usable)?.path ?? current;
}

// 下拉每项只显示标题（M3）；目录放 title 提示
export function lessonOptionLabel(l) {
  if (l.dev) return '我的课程（自定义）';
  if (l.missing) return '找不到的课程';
  if (l.broken) return '这门课程读不出来';
  if (l.title) return l.title;
  return (l.dir || l.path || '').split('/').filter(Boolean).at(-1) || '未命名课程';
}

export function lessonOptionTitle(l) {
  if (l.dev) return '项目根目录的 lesson.config.js';
  if (l.missing || l.broken) return l.path;
  return l.dir || l.path;
}

// "当前：《标题》· N 个环节"（M3：不再显示目录与 lesson.config.js，目录放首页"更多信息"）
// 读不出来时正文不放原始报错（原始报错由页面放进 title 提示）；找不到 与 写坏了 分开说
const BROKEN_META = '这门课程的文件有错，读不出来；请让帮你生成课程的 AI 检查后再试，或换一门课';
export function lessonSummary(lesson) {
  if (lesson?.missing) return { title: '找不到这门课程', meta: '课程文件不在了，请换一门课程' };
  if (!lesson || lesson.error || !lesson.title) return { title: '这门课程读不出来', meta: BROKEN_META };
  const n = lesson.stageCount;
  return { title: lesson.title, meta: Number.isInteger(n) && n > 0 ? `${n} 个环节` : '' };
}

export function classroomLesson(o) {
  const run = o?.runningLesson ?? o?.lesson ?? null;
  const ls = lessonSummary(run);
  const ok = run && !run.error && run.title;
  let next = '';
  if (o?.runningLesson && o?.lesson && o.lesson.path !== o.runningLesson.path) {
    next = o.lesson.error || !o.lesson.title
      ? '已换成的课程读不出来，重启前请换一门能用的课'
      : `已换成《${o.lesson.title}》，重启后生效`;
  }
  const dir = run?.dev ? '项目根目录（lesson.config.js）' : (run?.dir || run?.path || '—');
  return { title: ok ? `《${ls.title}》` : ls.title, meta: ls.meta, next, dir };
}

// ===== 课程检查（L1：check:lesson 的结果 { ok, errors, warnings, path?, lesson? }） =====
// 教师看到的是"问题 / 提醒"；"复制给 AI"的文本与命令行 npm run check:lesson 同格式（错误 / 警告）
export function checkSummary(r) {
  if (!r) return { tone: 'off', text: '还没有检查' };
  const n = r.errors?.length ?? 0;
  const m = r.warnings?.length ?? 0;
  if (n > 0) return { tone: 'bad', text: `课程有 ${n} 处问题${m ? `、${m} 处提醒` : ''}` };
  if (m > 0) return { tone: 'warn', text: `课程有 ${m} 处提醒` };
  return { tone: 'good', text: '没有发现问题' };
}

// 向导第 2 步、上课面板"更多信息"：有问题或提醒时才显示"课程有 … · 查看"
export function checkNotice(r) {
  if (!r || ((r.errors?.length ?? 0) === 0 && (r.warnings?.length ?? 0) === 0)) return null;
  return checkSummary(r);
}

const whereOf = (it) => (it.file ? `${it.file}${it.line ? `:${it.line}` : ''}` : '（课程）');

export function checkItems(r) {
  if (!r) return [];
  return [...(r.errors ?? []), ...(r.warnings ?? [])].map((it) => ({
    level: it.level, badge: it.level === 'error' ? '问题' : '提醒', where: whereOf(it), message: it.message, fix: it.fix,
  }));
}

// 与 scripts/check-lesson.mjs 的 formatItem / summaryLine 同格式（lesson-check.test.js 对照）
export function checkReportText(r, { title } = {}) {
  const items = [...(r?.errors ?? []), ...(r?.warnings ?? [])];
  const n = r?.errors?.length ?? 0;
  const m = r?.warnings?.length ?? 0;
  const lines = items.map((it) => `${it.level === 'error' ? '错误' : '警告'}  ${whereOf(it)}  ${it.message}${it.fix ? `  → ${it.fix}` : ''}`);
  const summary = n > 0 ? `${n} 处错误 ${m} 处警告` : (m > 0 ? `通过，${m} 处警告` : '通过');
  const name = title ? `《${title}》` : '这门课程';
  // 审查 4：命令带上课程路径（设置页可以查非当前的课）
  const target = r?.path ?? r?.lesson?.path ?? '';
  const cmd = `npm run check:lesson${target ? ` ${target}` : ''}`;
  return [
    `请帮我修改${name}的课程文件。下面是 ${cmd} 的检查结果，每条是"错误 | 警告  文件:行  问题  → 怎么改"。`,
    `先改"错误"，再看"警告"；改完再跑一次 ${cmd}，直到显示"通过"。`,
    '',
    ...lines,
    summary,
  ].join('\n');
}

// ===== 其它 =====
export function splitAddresses(urls) {
  const list = urls?.student ?? [];
  return { primary: list[0] ?? null, others: list.slice(1) };
}

export function logTail(lines, n = 20) {
  return (lines || []).slice(-n);
}

// ===== M4 课程页（发布包与课程管理规格 §4）：列表卡片的文案与按钮 =====
//   lessonCardStatus(row)：状态一句话（示例课 / 还没开始设计 / 做到第 N 环 · 下一步：… · 已做好 d / t 段）
//   lessonCardMeta(row)：环节数；draftNote(draft)：原稿提示（统一显示存盘后的固定名）；lessonCardOps(row)：这张卡有哪些按钮
//   uploadCheck(file)：上传前在页面里先查扩展名与大小（服务端还会再查）
//   LESSON_TEXT / lessonName(row)：课程页 app.js 里的提示语（toast、确认框、标签），集中在这里过禁词测试
export const DRAFT_EXTS = ['.md', '.txt', '.docx', '.pdf'];
export const MAX_DRAFT_BYTES = 20 * 1024 * 1024;

export function lessonCardStatus(row) {
  if (row?.broken) return BROKEN_META.replace(/，或换一门课$/, '');
  const s = row?.status ?? {};
  // 示例课一律"可直接上"（示例课目录里可能带着开发时的进度记录，不显示）
  if (row?.kind === 'example' || s.kind === 'example') return '示例课，可直接上';
  if (s.kind === 'none') return '还没开始设计';
  if (s.kind !== 'progress') return '做课进度记录读不出来，问问帮你做课的 AI';
  const parts = [];
  if (s.ring === 0) parts.push('还在准备环境');
  else if (Number.isInteger(s.ring)) parts.push(`做到第 ${s.ring} 环${s.ringName ? `（${s.ringName}）` : ''}`);
  if (s.next) parts.push(`下一步：${s.next}`);
  if (s.stagesTotal > 0) parts.push(`已做好 ${s.stagesDone} / ${s.stagesTotal} 段`);
  return parts.join(' · ') || '还没开始设计';
}

export function lessonCardMeta(row) {
  const n = row?.stages;
  return Number.isInteger(n) && n > 0 ? `${n} 个环节` : '还没有环节';
}

export function draftNote(draft) {
  if (!draft) return null;
  if (draft.ext === '.docx' && !draft.hasText) return { text: '已保存原稿，AI 读不了 Word 时请上传 txt 或 pdf', bad: true };
  return { text: `已上传：${draft.file}`, bad: false };
}

export function lessonCardOps(row) {
  const mine = row?.kind === 'mine';
  const ops = [];
  if (!row?.current && !row?.broken) ops.push({ id: 'current', label: '设为当前课程', title: '下次启动平台时上这门课（平台运行中换课，重启后生效）' });
  if (mine && !row?.broken) {
    ops.push({ id: 'opening', label: '复制开场话', title: '复制一段话，贴给帮你做课的 AI，它就知道从哪门课开始' });
    ops.push({ id: 'upload', label: row?.draft ? '重新上传教学设计' : '上传教学设计', title: '选 Word、PDF、Markdown 或纯文本文件（20 MB 以内）；再次上传会替换，旧的自动留一份' });
  }
  ops.push({ id: 'open', label: '打开文件夹', title: '在电脑上打开这门课的文件夹' });
  if (mine && !row?.current) ops.push({ id: 'delete', label: '删除这门课', title: '移到平台文件夹的备份里，不会直接删掉' });
  return ops;
}

export function uploadCheck(file) {
  const name = String(file?.name ?? '');
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!DRAFT_EXTS.includes(ext)) return '只能上传 Word（.docx）、PDF、Markdown（.md）或纯文本（.txt）文件';
  if (Number(file?.size) > MAX_DRAFT_BYTES) return '文件太大了，教学设计原稿不能超过 20 MB';
  return null;
}

export const lessonName = (row) => (row?.title ? `《${row.title}》` : '这门课');

export const LESSON_TEXT = {
  brokenTitle: '这门课程读不出来',
  noTitle: '（没有课名）',
  tagMine: '我的课',
  tagExample: '示例',
  tagCurrent: '当前',
  tagCurrentTitle: '下次启动平台时上这门课',
  current: (name, differs) => (differs ? `已把${name}设为当前课程，重启平台后生效` : `已把${name}设为当前课程`),
  opened: '已打开课程文件夹',
  deleteConfirm: (name) => `删除${name}？\n它会移到平台文件夹的备份里（不会直接删掉），课程列表里就看不到了。`,
  deleteOk: '删除这门课',
  deleted: (name) => `已删除${name}，文件移到了备份里`,
  needTitle: '请先填课名',
  created: (title) => `已新建《${title}》，它现在是当前课程`,
  uploadFailed: '上传没有完成，请再试一次',
  openingFailed: '没能取到开场话',
  copied: '已复制开场话，贴给帮你做课的 AI 就行',
  copiedButton: '已复制 ✓',
  downloadFailed: '下载失败',
};
