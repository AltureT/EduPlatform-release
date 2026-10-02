// 工作台页面逻辑里的纯函数（M2、M3）：页面 public/app.js 以 ES module 从 /ui-logic.js 引入；测试直接 import（__tests__/ui-logic.test.js）
// 只用浏览器与 Node 都有的标准 API，不依赖 DOM
//   G3（管理台线性路径重设计规格 §2）：routeFor(hash, fallback) → 页面（G5：左侧五步 pathSteps 改成主区页签 tabMarks / courseLead）；
//     buildDescOpen / buildSteps → "用 AI 做课"页三步与说明收展；classChecklist → "启动上课"页四行提醒（见"G3 线性路径"一节）
//     M3 首页向导（guideSteps / wizardView / wizardBackSteps / stepCounter）与 G1/G2 卡片步骤（showGuide / lessonGuideSteps）已删
//   G4（工作台课程与平台两区重构规格 §1）：PAGE_AREAS / PAGES / PAGE_TITLES / AREA_TITLES → 左栏两区九页；
//   G5（工作台侧栏常规化与页签步骤条规格）：顶栏下拉 courseOptions / MANAGE_OPTION 删除；侧栏 sideCourses / sideVersion / diagCountText；
//     页面 new / courses（原 course / manage）；TAB_PAGES = 主区四个页签；tabMarks / courseLead → 页签圆标与课名下一句
//     errorActions 的 goto-settings（密码 / 端口在平台 → 设置）；classChecklist 的环境一行只读
//   G4 收尾：envCurrent / envCheckRow / envLine / envTopText / envBanner / envRetryText / envCleansWith：课程要用的环境
//     （overview.env、SSE env，env-prepare.js status() 同形）在第 4、5 步检查单、平台 → 环境与版本、顶栏、横幅、删课确认框里的文案
//   S19：shareBanner(overview) → 横幅 #p-share（平台文件夹在网络共享里）的一句，没有 null
//   passwordError：设置页的密码；fetchProgress：下载输出 → 进度（服务端 env-prepare.js 用）
//   errorActions(error) → [{ id, label, title, ... }]：启动失败时可点的下一步（动态按钮都带 title 提示）
//   stateLabel(platform) → 状态带里的状态文字（已停止时区分"没能启动"与"平台意外停止"）
//   backupKind / backupSummary / fmtDate / fmtSize：备份列表"日期 · 大小 · 手动备份还是自动快照"
//   lessonChoices / lessonOptionLabel / lessonOptionTitle / lessonSummary：课程下拉（只显示标题，目录放 title）与"当前课程"
//   pickLesson(choices, current)：下拉默认选哪门（当前课找不到或读不出时选第一门能用的，M3 审查）
//   classroomLesson(overview)：上课面板的课程——平台正在跑的课 + "已换成《…》，重启后生效"（M3 审查）
//   splitAddresses / logTail
//   L1：checkSummary / checkNotice / checkItems / checkReportText：课程检查（check:lesson）的摘要、列表与"复制给 AI"的文本；
//     errorActions 的 'check'（课程有问题，没启动）→ "复制给 AI" + "改好了，再启动"
//   M4：lessonCardStatus / lessonCardMeta / draftNote / lessonCardOps / uploadCheck：课程列表（第 1 步）卡片（见文件末尾）
//   K7：platformFilesStatus："平台"页"版本"一行旁的"平台文件完好 / 有 N 处改动"（文件末尾）
//   R4：updateStatus / updateBandText / updateResultText / updateRecoveredText / UPDATE_TEXT：检查更新与一键升级的文案（文件末尾）
//   K8：aiTestText：上课准备页 AI 接口"测一下"的结果文案（文件末尾）
//   K9：aiModelsText：上课准备页"获取模型"按钮旁的提示（文件末尾）

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

// 与服务端 env-file.js validateSettings 的 TEACHER_PASSWORD 规则一致
export function passwordError(pw) {
  const v = String(pw ?? '');
  if (v.length === 0) return '密码不能为空';
  if (v.length < 6) return '密码至少 6 位';
  if (v.length > 64) return '密码不能超过 64 个字符';
  return null;
}

// 下载进度：按 scripts/fetch-pyodide.mjs 的输出行估算（国内镜像与 Gitee 同步规格 §4）
//   "来源：…" 每换一个来源重新开始；整包来源按"整包 x / y MB（n%）"与"解压并校验…"；
//   逐文件来源没有百分比输出，按阶段行估算（核心文件 → 扩展包 → 轮子 → 字体 → 完成）
const SOURCE_LABEL = [
  [/^国内镜像/, '正在从国内镜像下载…'],
  [/^GitHub/, '正在从 GitHub 下载…'],
  [/^本机文件/, '正在导入拷来的运行时…'],
  [/^自定义地址/, '正在从设置的下载源下载…'],
  [/^逐文件/, '正在逐个文件下载…'],
];
export function fetchProgress(lines = []) {
  let percent = 2;
  let label = '正在连接…';
  let closure = 0;
  let files = 0;
  for (const l of lines) {
    const src = /^来源：(.+)$/.exec(l);
    const zip = /^\s+整包 .*（(\d+)%）/.exec(l);
    const pk = /^包闭包 (\d+) 个/.exec(l);
    if (src) {
      [percent, closure, files] = [2, 0, 0];
      label = SOURCE_LABEL.find(([re]) => re.test(src[1]))?.[1] ?? '正在下载…';
    } else if (zip) percent = Math.max(percent, Math.min(90, 3 + Math.round((87 * Number(zip[1])) / 100)));
    else if (/^\s+解压并校验…/.test(l)) [percent, label] = [92, '正在解压并校验…'];
    else if (/^Pyodide /.test(l)) [percent, label] = [10, '正在下载核心文件…'];
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
const LOG = { id: 'show-log', label: '查看日志', title: '打开最近 500 行运行记录' };
const RETRY = { id: 'start', label: '已关掉，重试', title: '已经关掉占用端口的程序后，再启动一次' };
const START = { id: 'start', label: '启动平台', title: '再启动一次平台' };
// G4：goto-settings = 去平台区"设置"页并把光标放进 field 那一项（密码、端口、AI 接口从第 4 步搬到那里；G3 叫 goto-prepare）
const OTHER_PORT = { id: 'goto-settings', label: '换一个端口', field: 'PORT', title: '到平台 → 设置换一个端口，例如 3001 或 8080' };

export function errorActions(err) {
  if (!err) return [];
  switch (err.kind) {
    // G5：去新建课程 → #new；换一门课程 → 全部课程（#courses）
    case 'no-lesson':
      return [{ id: 'new', label: '去新建课程', title: '新建一门课，新建后它就是当前课程' }];
    case 'lesson':
      return [{ id: 'courses', label: '换一门课程', title: '到全部课程换一门能用的课，或新建一门' }];
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
      return [{ id: 'goto-settings', label: '去改端口', field: 'PORT', title: '到平台 → 设置把端口改成 1 到 65535 之间的整数' }];
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
  if (lesson?.none) return { title: '还没有课程', meta: '先新建一门' };
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

// V1（代码题测试验证规格 §5.5）：启动前检查只在课程加载不了时拦下；其它问题照常启动，状态带一行提示（只有提醒时不显示，放"更多信息"）
export function checkBandText(p) {
  const c = p?.check;
  const n = c?.errors?.length ?? 0;
  if (!p || p.state === 'stopped' || n === 0) return null;
  const m = c.warnings?.length ?? 0;
  return `课程有 ${n} 处问题${m ? `、${m} 处提醒` : ''}，已照常启动`;
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
  // 审查 4：命令带上课程路径（可以查非当前的课）
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

// ===== M4 课程列表（第 1 步）（发布包与课程管理规格 §4）：列表卡片的文案与按钮 =====
//   lessonCardStatus(row)：状态一句话（示例课 / 还没开始设计 / 做到第 N 环 · 下一步：… · 已做好 d / t 段）
//   lessonCardMeta(row)：环节数；draftNote(draft)：原稿提示（统一显示存盘后的固定名）；lessonCardOps(row)：这张卡有哪些按钮
//   uploadCheck(file)：上传前在页面里先查扩展名与大小（服务端还会再查）
//   G3：课程列表（第 1 步）小卡只剩"继续 →"（当前课）/"设为当前课程""打开文件夹""删除这门课"；做课步骤与备课进度都在"用 AI 做课"页；lessonNextLead 见下
//   LESSON_TEXT / lessonName(row)：课程列表（第 1 步） app.js 里的提示语（toast、确认框、标签），集中在这里过禁词测试
//   M6：LESSON_TEXT 也收名单一节 / 数据页的提示语；lessonDataLine / lessonPickOptions / parseTabHash / migratedText 见 LESSON_TEXT 之后
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

// S17（教案 PDF 抽文本与粘贴规格 §3）：读出了文字 → 字数 + 开头 60 字；PDF 读不出 → 请传 Word 或粘贴；docx 读不出照旧
// S20 §2：抽失败（textError）和"没有文字层"（扫描件）分两句；docx 抽失败也说"把排障文件发给 AI"
//   有文本版（AI 按 §4 自己读出来写了 .txt）就照"已读出"说，不再提抽失败
export function draftNote(draft) {
  if (!draft) return null;
  if (draft.ext === '.pdf' && !draft.hasText && draft.textError) return { text: LESSON_TEXT.draftFailed, bad: true };
  if (draft.ext === '.pdf' && !draft.hasText) return { text: LESSON_TEXT.draftScanned, bad: true };
  if (draft.ext === '.docx' && !draft.hasText && draft.textError) return { text: LESSON_TEXT.draftDocxFailed, bad: true };
  if (draft.ext === '.docx' && !draft.hasText) return { text: '已保存原稿，AI 读不了 Word 时请上传 txt 或 pdf', bad: true };
  if (draft.hasText && draft.chars > 0) {
    const head = String(draft.head ?? '');
    const more = draft.chars > head.replace(/\s+/g, '').length ? '…' : '';
    return { text: `${LESSON_TEXT.draftRead(draft.chars)}，AI 会读它。开头：${head}${more}`, bad: false };
  }
  return { text: `已上传：${draft.file}`, bad: false };
}

// G3（管理台线性路径重设计规格 §2.3.1）：当前课 → "继续 →"（去当前该做的那一步）+ 打开文件夹；
//   其它 → 设为当前课程（读不出来的不给）、打开文件夹、删除这门课（我的课）
// G4（工作台两区重构规格 §1，卡片在"管理"页）：我的课（读得出来的）加"重命名"；当前课也能删（删后自动换到下一门 / 清空）
export function lessonCardOps(row) {
  const T = LESSON_TEXT;
  const mine = row?.kind === 'mine';
  const ops = [];
  if (row?.current) ops.push({ id: 'continue', label: T.cardContinue, title: T.cardContinueTitle });
  else if (!row?.broken) ops.push({ id: 'current', label: '设为当前课程', title: '换成这门课；平台运行中换课，重启后生效' });
  if (mine && !row?.broken) ops.push({ id: 'rename', label: '重命名', title: T.renameTitle });
  ops.push({ id: 'open', label: '打开文件夹', title: '在电脑上打开这门课的文件夹' });
  if (mine) {
    ops.push({
      id: 'delete', label: '删除这门课',
      title: row?.current ? '移到平台文件夹的备份里；当前课程会换成下一门' : '移到平台文件夹的备份里，不会直接删掉',
    });
  }
  return ops;
}

// G4：删掉当前课以后哪门成为当前课——与服务端 lesson-admin.js deleteLesson 同一规则：
//   我的课按目录名排序，删掉的后一门；它是最后一门则前一门；没有别的课 → null（删后还没有课程）
export function nextCurrentAfterDelete(rows, dir) {
  const name = String(dir ?? '').split('/').at(-1);
  const mine = (rows ?? []).filter((r) => r?.kind === 'mine' && typeof r.dir === 'string' && r.dir !== dir)
    .map((r) => ({ r, n: r.dir.split('/').at(-1) }))
    .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
  if (mine.length === 0) return null;
  return (mine.find((x) => x.n > name) ?? mine.at(-1)).r;
}

// lessonNextLead(row)："用 AI 做课"页标题下的一句引导（还没开始 / AI 做到哪）
// 做课进行中：优先"下一步"原文，没有则"第 N 环"；都没有（或进度读不出来）按还没开始说
export function lessonNextLead(row) {
  const s = row?.status ?? {};
  if (s.kind === 'progress') {
    const next = s.next || (Number.isInteger(s.ring) ? `第 ${s.ring} 环` : '');
    if (next) return LESSON_TEXT.nextProgress(next);
  }
  return LESSON_TEXT.nextNone;
}

export function uploadCheck(file) {
  const name = String(file?.name ?? '');
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!DRAFT_EXTS.includes(ext)) return '只能上传 Word（.docx）、PDF、Markdown（.md）或纯文本（.txt）文件';
  if (Number(file?.size) > MAX_DRAFT_BYTES) return '文件太大了，教案不能超过 20 MB';
  return null;
}

export const lessonName = (row) => (row?.title ? `《${row.title}》` : '这门课');

// ===== V1 只读备课表（代码题测试验证规格 §5）：进度记录的阶段表 + 最近一次检查的"测试"列 =====
//   showProgressTable(row)：我的课、有进度记录才显示（示例课不显示）
//   progressTableRows(status, check) → [{ cells: 9 × { text, tone: 'ok'|'off'|'warn'|'bad'|'plain', title? } }]
//     status = lessonStatus（stages 逐行原文）；check = 课程行的 check 摘要（{ tests: [...] }，没查过 null）
export const PROGRESS_COLUMNS = ['段', '做法', '骨架', '内容', '检查', '模拟', '审查', '存档', '测试'];

export function showProgressTable(row) {
  return row?.kind === 'mine' && row?.status?.kind === 'progress';
}

// G4（工作台两区重构规格 §2）：单元格只显示 ✓ / ✗ / —，附注放 title——
//   "✓自审" → ✓ + title"自审"；"✗（原因）" → ✗ + title 原因；空格 → —；"未存档"等别的原文照旧显示（老师要知道的状态）
function progressCell(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { text: '—', tone: 'plain' };
  const why = /^✗\s*[（(](.+)[）)]$/.exec(text);
  if (why) return { text: '✗', tone: 'off', title: why[1].trim() };
  if (text === '✗') return { text, tone: 'off' };
  if (text.startsWith('✓')) {
    const note = text.slice(1).trim();
    return note ? { text: '✓', tone: 'ok', title: note } : { text: '✓', tone: 'ok' };
  }
  return { text, tone: 'plain' };
}

// 测试列：✓ / ✗ + title（"已验证 · 用例 N …""参考答案没过"等）；"没验证"保留文字；没查过 — + title"还没检查"
function testsCell(dir, check) {
  if (!check) return { text: '—', tone: 'off', title: '还没检查' };
  const t = (check.tests ?? []).find((x) => x?.dir === dir);
  if (!t) return { text: '—', tone: 'plain' };
  if (t.solution === 'pass') {
    const m = t.mutants;
    // V2（代码题批改规格 §6）：extra 里有且 > 0 才追加"· 隐藏 N · 错误库 M"
    const n = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
    const more = `${n(t.extra?.hidden) ? ` · 隐藏 ${t.extra.hidden}` : ''}${n(t.extra?.mistakes) ? ` · 错误库 ${t.extra.mistakes}` : ''}`;
    return { text: '✓', tone: 'ok', title: `已验证 · 用例 ${t.cases}${m ? ` · 抓住 ${m.killed}/${m.total}` : ''}${more}` };
  }
  if (t.solution === 'fail') return { text: '✗', tone: 'bad', title: '参考答案没过' };
  if (t.solution === 'timeout') return { text: '✗', tone: 'bad', title: '参考答案超时' };
  if (t.solution === 'missing') return { text: '✗', tone: 'warn', title: '没有参考答案' };
  return { text: '没验证', tone: 'warn' };
}

// G4 §2："做法"列按固定对照显示教学词，内部名放 title；对照表外的原样显示
export const PROGRESS_HOW = {
  vote: '投票', quiz: '小测验', 'free-text': '写一段话', code: '写程序', 'data-analysis': '分析数据', none: '专门做的页面',
};
function howCell(raw) {
  const how = String(raw ?? '').trim();
  if (how === '') return { text: '—', tone: 'plain' };
  return Object.hasOwn(PROGRESS_HOW, how) ? { text: PROGRESS_HOW[how], tone: 'plain', title: how } : { text: how, tone: 'plain' };
}

export function progressTableRows(status, check) {
  if (status?.kind !== 'progress') return [];
  return (status.stages ?? []).map((s) => ({
    cells: [
      { text: String(s.label ?? ''), tone: 'plain' },
      howCell(s.how),
      ...(s.cells ?? []).slice(0, 6).map(progressCell),
      testsCell(s.dir, check),
    ],
  }));
}

export const LESSON_TEXT = {
  brokenTitle: '这门课程读不出来',
  noTitle: '（没有课名）',
  tagExample: '示例',
  tagCurrent: '当前',
  tagCurrentTitle: '下次启动平台时上这门课',
  current: (name, differs) => (differs ? `已把${name}设为当前课程，重启平台后生效` : `已把${name}设为当前课程`),
  opened: '已打开课程文件夹',
  // G4：当前课也能删——opts = { current: true, next: '《下一门》' | null }；
  //   G4 收尾（§3.3）：opts.env = 这门课是唯一需要 Python 环境的课（envCleansWith）→ 加一句会一起清理
  deleteConfirm: (name, opts) => {
    const env = opts?.env ? '\n这门课用的 Python 环境没有别的课要用，会一起清理（以后需要会自动再准备）。' : '';
    if (!opts?.current) return `删除${name}？\n它会移到平台文件夹的备份里（不会直接删掉），课程列表里就看不到了。${env}`;
    const after = opts.next ? `删除后当前课程换成${opts.next}` : '删除后就还没有课程了，要再新建一门';
    return `删除${name}？\n它是当前课程，${after}。\n它会移到平台文件夹的备份里（不会直接删掉）。${env}`;
  },
  deleteOk: '删除这门课',
  deleted: (name) => `已删除${name}，文件移到了备份里`,
  deletedSwitched: (name, next) => (next ? `已删除${name}，当前课程换成${next}` : `已删除${name}，现在还没有课程`),
  // G4 收尾：DELETE 返回 cleaned（清掉的环境种类）非空 → 删课提示后面加一句
  withCleaned: (text, cleaned) => (cleaned?.length ? `${text}。Python 环境已随课程清理` : text),
  // G4 重命名（管理页卡片 → 对话框）
  renameTitle: '改这门课的课名；只改名字，内容和数据都不动',
  renameHead: '改课名',
  renameOk: '改名',
  renamed: (title) => `已改名为《${title}》`,
  needTitle: '请先填课名',
  created: (title) => `已新建《${title}》，接着上传教案`,
  uploadFailed: '上传没有完成，请再试一次',
  openingFailed: '没能取到开场话',
  copied: '已复制开场话，贴给帮你做课的 AI 就行',
  copiedButton: '已复制 ✓',
  // V1 只读备课表
  progressToggle: '备课进度',
  progressNote: '这张表由帮你做课的 AI 更新；要改课，把想法告诉它。',
  progressEmpty: '还没有做到分段',
  progressCheck: '检查课程',
  progressCheckTitle: '检查这门课有没有写错的地方、代码题的测试验证了没有，查完表会刷新（不用启动平台）',
  progressChecking: '正在检查…',
  // G1 做课步骤（做课步骤引导规格 §2.1，句子照抄）；G3 搬到"用 AI 做课"页，去掉"上传教案"一步（四步改三步）
  nextNone: '照这三步，把这门课交给 AI 来做',
  nextProgress: (next) => `AI 做到：${next}。要继续，打开开发工具、贴开场话就行`,
  guideToolStep: '打开 AI 开发工具',
  guideToolDesc: 'Claude Code、Trae、Cursor 这类能读写文件、能运行命令的 AI 开发工具都可以；用你平时用的那个。',
  guideFolderStep: '在开发工具里打开平台文件夹（不是这门课的文件夹）',
  guideFolderDesc: "开发工具里选'打开文件夹'，选下面这个位置；也可以点'打开文件夹'后把它拖进开发工具。",
  guideOpeningStep: '复制开场话，贴给 AI',
  guideOpeningDesc: "把开场话贴进开发工具的对话框发送，之后照它的问题回答就行，它会一段一段和你把课定下来。做到哪一步，下面'备课进度'会同步更新；想改哪里，直接告诉它。",
  guideUpload: (hasDraft) => (hasDraft ? '重新上传教案' : '上传教案'),
  guideUploadTitle: '选 Word、PDF、Markdown 或纯文本文件（20 MB 以内）；再次上传会替换，旧的自动留一份',
  guideOpening: '复制开场话',
  guideOpeningTitle: '复制一段话，贴给帮你做课的 AI，它就知道从哪门课开始',
  guidePathTitle: '平台文件夹在电脑上的位置',
  guidePathMissing: '正在读取…',
  guideCopyPath: '复制位置',
  guideCopyPathTitle: '复制平台文件夹的位置，到开发工具里打开文件夹时粘贴',
  guideCopiedPath: '已复制平台文件夹的位置',
  guideCopyPathManualTitle: '请手动复制这个位置',
  guideCopyPathManual: '这台电脑不让网页直接复制。下面的位置已经选好，按 Ctrl+C（Mac 按 Command+C）复制，再到开发工具里打开文件夹时粘贴。',
  guideOpenPlatform: '打开文件夹',
  guideOpenPlatformTitle: '在电脑上打开平台文件夹，可以把它拖进开发工具',
  guideOpenedPlatform: '已打开平台文件夹',
  // G3 课程列表（第 1 步）小卡、教案页、做课页、上课页（管理台线性路径重设计规格 §2.3）
  cardContinue: '继续 →',
  cardContinueTitle: '去当前该做的那一步',
  draftUploaded: (note) => `${note}，接着去做课`,
  draftRead: (n) => `已读出 ${n} 字`,
  draftScanned: '这份 PDF 没有文字层（多半是扫描件）。请上传 Word 或文本，或在下面粘贴。',
  draftFailed: '平台没能读出这份 PDF 的文字（不是扫描件的问题）。可以在下面粘贴文字，或把"排障文件"发给 AI。',
  draftDocxFailed: '平台没能读出这份 Word 的文字。可以在下面粘贴，或把"排障文件"发给 AI。',
  pasteEmpty: '框里还没有文字，先把教案粘进来',
  pasteTooBig: '文字太长了，粘贴不能超过 200 KB；请改成上传文件',
  draftGoSkip: '没有教案，跳过 → 去做课',
  draftGoNext: '接着去做课 →',
  notMine: '示例课不能上传教案、复制开场话；想照着它做一门，请先新建课程',
  draftLineSome: (file) => `教案：已上传 ${file}`,
  draftLineNone: '教案：没有上传',
  draftLineEdit: '改 →',
  draftLineAdd: '上传 →',
  descOpen: '展开说明',
  descClose: '收起说明',
  // M6（名单与数据以课程为主体规格 §2.4）：名单 / 数据的提示语
  pickRunning: (name) => `${name}（正在上）`,
  pickCurrent: (name) => `${name}（当前）`,
  rosterStatus: (count, bound) => (count ? `名单共 ${count} 人，已绑定设备 ${bound ?? 0} 台` : '还没有导入名单（学生加入时自己填名字）'),
  rosterMore: (count) => ` … 等 ${count} 人`,
  previewCount: (count) => (count ? `解析出 ${count} 个名字` : '没有解析出名字，请检查是否每行一个名字'),
  imported: (count) => `已导入 ${count} 个名字`,
  clearConfirm: (name) => `清空${name}的名单后，学生加入时要自己填写名字。`,
  clearOk: '清空名单',
  cleared: '名单已清空',
  bindConfirm: (name) => `${name}所有设备和名字的对应关系会被解除，学生需要重新选择自己的名字。`,
  bindOk: '解除所有设备绑定',
  bindDone: '设备绑定已重置',
  backedUp: (file) => `已备份：${file}`,
  resetDesc: (running) => (running ? '这门课正在上：重置后学生页面回到登录页；名单保留。' : '清除学生记录和学生做的内容；名单保留。'),
  resetConfirm: (name, running) => `将清除${name}的学生记录、设备绑定和各环节里学生做的内容，课堂回到第一个环节；名单保留。${running === true ? '所有学生设备会回到登录页。' : ''}\n重置前会自动备份一份。`,
  resetOk: '重置并回到第一环节',
  resetDone: (snapshot) => `已重置（名单保留），重置前的数据已存为 ${snapshot || '（原本没有数据）'}`,
  download: '下载',
  downloadTitle: '把这份备份存到别处',
  downloadFailed: '下载失败',
  restore: '恢复这份',
  restoreTitle: '用这份备份覆盖这门课的课堂数据（这门课正在上时先停止平台）',
  restoreRunning: '这门课正在上，请先停止平台，再恢复备份',
  restoreConfirm: (file, name = '这门课') => `用 ${file} 覆盖${name}的课堂数据。\n恢复前会自动把当前数据备份一份。恢复后学生下次进入会回到登录页。`,
  restoreFrom: (from, to = '这门课') => `这份备份来自${from}，确定恢复到${to}？`,
  otherLesson: '另一门课',
  restoreOk: '覆盖并恢复这份备份',
  restored: (snapshot) => `已恢复。恢复前的数据已存为 ${snapshot || '（原本没有数据）'}。学生下次进入会回到登录页`,
  unsortedRestore: (name) => `恢复到${name}`,
  unsortedRestoreTitle: '用这份旧备份覆盖上面选中的这门课的课堂数据',
  unsortedBackup: '备份一份',
  unsortedBackupTitle: '把未归类的旧数据存一份，可以下载或恢复到某门课',
  unsortedDelete: '删除',
  unsortedDeleteTitle: '移到平台文件夹的备份里，不会直接删掉',
  unsortedDeleteConfirm: '删除未归类的旧数据？\n它会移到平台文件夹的备份里（不会直接删掉）。',
  unsortedDeleteOk: '删除旧数据',
  unsortedDeleted: '已删除，文件移到了备份里',
  migrated: '课堂数据已按课程整理：每门课有自己的名单和数据',
  migratedUnsorted: '课堂数据已按课程整理；有一份看不出属于哪门课，放在数据页的"未归类的旧数据"里',
  dbCustom: (size) => `自定义位置（${size}）`,
  rosterCount: (n) => (n ? `${n} 人` : '没有名单'),
};

// M6（名单与数据以课程为主体规格 §2.4）：课程卡片一行"名单 N 人 · 数据 M KB · 最近备份 <时间或"没有">"；库还不存在"还没有数据"
export function lessonDataLine(row) {
  const d = row?.data;
  if (!d) return '还没有数据';
  return `名单 ${d.roster ?? 0} 人 · 数据 ${fmtSize(d.dbBytes)} · 最近备份 ${d.lastBackup ? fmtDate(d.lastBackup.mtime) : '没有'}`;
}

// 名单一节 / 数据页的课程选择：rows = /api/lessons/overview（我的课在前）；读不出来的课不列；
//   runningDir / currentDir 标"正在上""当前"；缺省（这两页没选过）= 正在跑的课，没在跑则当前课；
//   正在跑 / 当前是根目录开发课（dir ''）时另加一项 value '.'
//   → { options: [{ value, label }], selected }
export function lessonPickOptions(rows, { runningDir = null, currentDir = null, devTitle = null, picked = '' } = {}) {
  const T = LESSON_TEXT;
  const label = (name, dir) => (dir === runningDir ? T.pickRunning(name) : dir === currentDir ? T.pickCurrent(name) : name);
  const options = (rows ?? []).filter((r) => !r.broken && r.dir).map((r) => ({ value: r.dir, label: label(lessonName(r), r.dir) }));
  if (runningDir === '' || (runningDir === null && currentDir === '')) {
    options.push({ value: '.', label: label(lessonName({ title: devTitle }), '') });
  }
  const fallback = runningDir ?? currentDir;
  const want = picked || (fallback === '' ? '.' : fallback);
  const selected = options.some((o) => o.value === want) ? want : options[0]?.value ?? '';
  return { options, selected };
}

// 地址栏井号：#roster?lesson=<课程目录> → { name: 'roster', lesson: '<课程目录>' }
export function parseTabHash(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  const i = h.indexOf('?');
  const name = i < 0 ? h : h.slice(0, i);
  const lesson = i < 0 ? null : new URLSearchParams(h.slice(i + 1)).get('lesson');
  return { name, lesson: lesson || null };
}

export function migratedText(m) {
  if (!m) return '';
  return m.unsorted ? LESSON_TEXT.migratedUnsorted : LESSON_TEXT.migrated;
}

// K7（框架自描述规格 §4）："平台"页"版本"一行旁的平台文件状态；pf = GET /api/settings 的 platformFiles
//   → { version, label, dot, title, changed }；改动的文件清单只放 title
export function platformFilesStatus(pf) {
  const version = pf?.version ?? '—';
  if (!pf?.checked) return { version, label: '开发版，不检查平台文件', dot: 'off', title: '平台文件夹里没有发布包带的版本记录', changed: false };
  if (!pf.changes) return { version, label: '平台文件完好', dot: 'good', title: `共 ${pf.total ?? 0} 个平台文件，与发布包一致`, changed: false };
  const lines = [
    ...(pf.modified ?? []).map((f) => `改动 ${f}`),
    ...(pf.missing ?? []).map((f) => `缺失 ${f}`),
    ...(pf.added ?? []).map((f) => `多出 ${f}`),
  ];
  const more = pf.changes > lines.length ? [`……共 ${pf.changes} 处`] : [];
  return { version, label: `有 ${pf.changes} 处改动`, dot: 'busy', title: [...lines, ...more].join('\n'), changed: true };
}

// R4（管理台更新规格 §5）："平台"页"平台版本"一节的检查 / 更新，横幅区"有新版本"一行，更新结束后的文案
//   u = overview / settings 的 update：{ current, dev, latest, checkedAt, running, result }
export const UPDATE_TEXT = {
  check: '检查更新',
  checking: '正在查…',
  apply: '下载并更新',
  confirm: '再点一次确认',
  applying: '正在更新…',
  never: '还没检查过',
  dev: '开发版，不更新',
  stopFirst: '先停止平台',
  wait: '平台正在启动或停止，请稍候',
  done: '更新完成，工作台正在重新打开；这个页面可以关掉',
  reopened: '新的工作台已打开，这个页面可以关掉',
  recovered: '上次更新没有完成，已恢复到更新前',
  recoverFailed: '上次更新没有完成，恢复也没有全部成功：请重新解压发布包覆盖平台文件夹（课程、课堂数据和设置不会丢）',
};

// 工作台启动时发现上次更新被打断并已恢复（update.recovered）→ 首页一行；备份目录只放 title
export function updateRecoveredText(u) {
  const r = u?.recovered;
  if (!r) return null;
  return {
    text: r.ok ? UPDATE_TEXT.recovered : UPDATE_TEXT.recoverFailed,
    title: r.backupDir ? `更新前的文件备份在平台文件夹的 ${r.backupDir}` : '',
    bad: !r.ok,
  };
}

export function updateStatus(u, { platformState = 'stopped', checking = false, armed = false } = {}) {
  const T = UPDATE_TEXT;
  const running = Boolean(u?.running);
  let line = T.never;
  if (u?.dev) line = T.dev;
  else if (u?.latest) line = `最新 v${u.latest.version}（${u.latest.source ?? '发布页'}）· 有新版本`;
  else if (u?.checkedAt) line = `已是最新（${fmtDate(u.checkedAt)}）`;
  let help = '';
  if (platformState === 'running') help = T.stopFirst;
  else if (platformState !== 'stopped') help = T.wait;
  return {
    line,
    checkLabel: checking ? T.checking : T.check,
    checkDisabled: checking || running,
    showApply: !u?.dev && Boolean(u?.latest),
    applyLabel: running ? T.applying : armed ? T.confirm : T.apply,
    applyDisabled: running || platformState !== 'stopped',
    help,
  };
}

export function updateBandText(u) {
  if (!u?.latest || u.dev) return null;
  return `有新版本 v${u.latest.version} · 到"平台"页更新`;
}

// result = SSE update 的 done 事件（或 overview.update.result）→ { text, title, bad }；备份目录只放 title
export function updateResultText(result) {
  if (!result) return null;
  if (result.ok) return { text: UPDATE_TEXT.done, title: '', bad: false };
  const byCode = {
    2: '下载没有完成，请检查网络后再试',
    3: '下载的包不完整或被改过，平台没有改动，可以再试一次',
    4: '更新失败，已恢复到更新前',
    5: '更新失败，恢复也没有成功：请重新解压发布包覆盖平台文件夹（课程、课堂数据和设置不会丢）',
  };
  return {
    text: byCode[result.code] ?? '更新没有完成，平台没有改动',
    title: result.backupDir ? `更新前的文件备份在平台文件夹的 ${result.backupDir}` : '',
    bad: true,
  };
}

// K8：上课准备页"测一下"按钮旁的结果——"通了 · 1.2 秒" / "没通：密钥不对"
export function aiTestText(r) {
  if (r && r.ok === true) return `通了 · ${(Math.max(0, Number(r.ms) || 0) / 1000).toFixed(1)} 秒`;
  return `没通：${typeof r?.text === 'string' && r.text ? r.text : '出错了'}`;
}

// K9：上课准备页"获取模型"按钮旁的提示——"共 N 个，点输入框选一个"；N = 0 或失败显示失败文案（服务端给的中文）
export function aiModelsText(r) {
  const n = r && r.ok === true && Array.isArray(r.models) ? r.models.length : 0;
  if (n > 0) return `共 ${n} 个，点输入框选一个`;
  if (r && r.ok === true) return '没有返回模型列表，请手动填模型名';
  return typeof r?.text === 'string' && r.text ? r.text : '出错了';
}

// ===== G3 线性路径（管理台线性路径重设计规格 §2）=====
// G4（工作台课程与平台两区重构规格 §1）：九个页面（地址栏井号即页面），左侧两区：
//   课程 = 五步 + 管理（我的课程列表）+ 数据；平台 = 设置（密码 / 端口 / AI 接口）+ 环境与版本（#platform，井号沿用 G3）
export const PAGE_AREAS = {
  course: ['new', 'draft', 'build', 'prepare', 'class', 'courses', 'data'],
  platform: ['settings', 'platform'],
};
export const PAGES = [...PAGE_AREAS.course, ...PAGE_AREAS.platform];
// G5（工作台侧栏常规化与页签步骤条规格 §2.2、§4）：主区页签四页（= G3 第 2–5 步，内容不变）；新建在侧栏（#new），全部课程 = 原"管理"（#courses）
export const TAB_PAGES = ['draft', 'build', 'prepare', 'class'];
// G5：侧栏与页签上的名字；两个区标题"课程""平台"
export const PAGE_TITLES = {
  new: '新建课程', draft: '教案', build: '做课', prepare: '上课准备', class: '启动上课',
  courses: '全部课程', data: '数据', settings: '设置', platform: '环境与版本',
};
export const AREA_TITLES = { course: '课程', platform: '平台' };
// ===== G5 页签式步骤条（工作台侧栏常规化与页签步骤条规格 §2.2；替代 G3 的 pathSteps 左侧五步）=====
// overview（/api/overview，带 currentLesson）→ { tabs: [{ id, title, n, mark }], nextId }
//   mark：'done'（✓ 这步做完）| 'todo'（! 这一步有要老师做的事）| 'wait'（数字 = 还没到）
//   教案：有原稿或 AI 已开始做课（status progress）✓（"跳过" = 没传教案就让 AI 开始做课）；否则 !
//   做课：最近一次课程检查有错误 !；有环节 ✓；AI 还没开始 !；AI 在做、还没有环节 → 数字
//   上课准备：名单可选，只看环境——当前课要的环境已就绪（或不需要）✓；否则 !（没有名单只在检查单里提一句"没有名单，学生会自己输名字"）
//   启动上课：运行中（平台上的就是这门课）✓；没启动（或在上别的课）且前三步都 ✓ → !；否则数字
//   nextId（当前该做的那一页）：运行中（同上）class；否则第一个没 ✓ 的；全 ✓ 时 class。没有课程或读不出来：全是数字、draft
const NEXT_TEXT = { draft: '上传教案', build: '用 AI 做课', prepare: '上课准备', class: '启动上课' };
// 平台正在上的是不是当前课（运行中换了当前课、还没重启时不是）
const runningThis = (o) => o?.platform?.state === 'running'
  && (!o.runningLesson?.path || normCfg(o.runningLesson.path) === normCfg(o.currentLesson?.path));
export function tabMarks(o) {
  const cl = o?.currentLesson ?? null;
  const ids = TAB_PAGES;
  const make = (mk) => ({ tabs: ids.map((id, i) => ({ id, title: PAGE_TITLES[id], n: i + 1, mark: mk[id] })), nextId: null });
  if (!cl || cl.broken) return { ...make(Object.fromEntries(ids.map((id) => [id, 'wait']))), nextId: 'draft' };
  const st = cl.status ?? {};
  const started = st.kind === 'progress';
  const stages = Number.isInteger(cl.stages) ? cl.stages : 0;
  const env = envCurrent(o);
  const running = runningThis(o);
  const mk = {};
  mk.draft = cl.draft || started || stages > 0 ? 'done' : 'todo'; // 已有环节 = AI 早开始了，教案这步算过
  if ((o?.check?.errors?.length ?? 0) > 0) mk.build = 'todo';
  else if (stages > 0) mk.build = 'done';
  else mk.build = started ? 'wait' : 'todo';
  const envOk = !env.needed || env.state === 'ready';
  mk.prepare = envOk ? 'done' : 'todo';
  if (running) mk.class = 'done';
  else {
    // 没启动，或平台在上别的课（要重启才换成这门）；正在准备 / 启动 / 停止时是数字
    const st = o?.platform?.state ?? 'stopped';
    const idle = st === 'stopped' || st === 'running';
    mk.class = idle && ['draft', 'build', 'prepare'].every((id) => mk[id] === 'done') ? 'todo' : 'wait';
  }
  // 步骤是顺序的：第一个没做完的步骤之后，一律显示数字（"还没到"），哪怕它自己没有要做的事
  //   （例：刚新建的课，上课准备什么都不需要，也不能先打勾）；正在上这门课时"启动上课"仍是 ✓
  let blocked = false;
  for (const id of ids) {
    if (blocked && !(id === 'class' && running)) mk[id] = 'wait';
    else if (mk[id] !== 'done') blocked = true;
  }
  const r = make(mk);
  r.nextId = running ? 'class' : ids.find((id) => mk[id] !== 'done') ?? 'class';
  return r;
}

// 课名下面一句状态（G5 §2.1）："下一步：上传教案"、"做到第 5 环 · 下一步：上课准备"；运行中"正在上课"；没有课程 ''
export function courseLead(o) {
  const cl = o?.currentLesson ?? null;
  if (!cl) return '';
  if (cl.broken) return LESSON_TEXT.brokenTitle;
  const st = cl.status ?? {};
  const ring = st.kind === 'progress' && Number.isInteger(st.ring) && st.ring > 0 ? `做到第 ${st.ring} 环` : '';
  const { nextId } = tabMarks(o);
  const tail = runningThis(o) ? '正在上课' : `下一步：${NEXT_TEXT[nextId]}`;
  return ring ? `${ring} · ${tail}` : tail;
}

// 地址栏井号 → { page, lesson?, focus? }：九个页面原样；空 / #home / 不认识 → fallback（页面给"当前该做的那一页"，没有则 new）；
//   旧井号（G5 §4）：#course（G3 第 1 步）→ new，#manage（G4 管理）/ #lessons → courses，#roster → prepare（滚到名单一节），
//   #data?lesson= 保留 lesson；不带 lesson 的 #data → lesson: ''（页面据此复位回当前课：从侧栏点"数据"不沿用上次看的别的课）
const OLD_HASH = { course: { page: 'new' }, manage: { page: 'courses' }, lessons: { page: 'courses' }, roster: { page: 'prepare', focus: 'roster' } };
export function routeFor(hash, fallback) {
  const { name, lesson } = parseTabHash(hash);
  if (name === 'data') return { page: 'data', lesson: lesson || '' };
  if (PAGES.includes(name)) return { page: name };
  if (OLD_HASH[name]) return { ...OLD_HASH[name] };
  return { page: fallback && PAGES.includes(fallback) ? fallback : 'new' };
}

// G5 §1 侧栏课程列表：rows = /api/lessons/overview → { items: [{ dir, path, label, current, broken }], total, count }
//   只列 lessons/ 下的课（kind mine，示例课不列），按目录名排序，最多 max 门；count = "全部课程"右侧的数字（超过 max 门或一门都没有时给总数，否则 null）
export const SIDE_MAX = 8;
export function sideCourses(rows, max = SIDE_MAX) {
  const name = (r) => r.dir.split('/').at(-1);
  const mine = (rows ?? []).filter((r) => r?.kind === 'mine' && typeof r.dir === 'string')
    .sort((a, b) => (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0));
  const items = mine.slice(0, max).map((r) => ({
    dir: r.dir, path: r.path, current: Boolean(r.current), broken: Boolean(r.broken),
    label: r.broken ? LESSON_TEXT.brokenTitle : r.title || name(r),
  }));
  const total = mine.length;
  return { items, total, count: total > max || total === 0 ? total : null };
}

// G5 §1 侧栏底部版本行：u = overview.update → { text, fresh }（fresh = 有新版本，蓝字）
export function sideVersion(u) {
  if (!u?.current) return { text: '', fresh: false };
  if (u.dev) return { text: `v${u.current} · 开发版`, fresh: false };
  if (u.latest) return { text: `有新版本 v${u.latest.version}`, fresh: true };
  return { text: u.checkedAt ? `v${u.current} · 已是最新` : `v${u.current}`, fresh: false };
}

// G5 §1 侧栏底部"排障文件"右侧的数字：overview.diagnoses.count；0 或没有时不显示
export function diagCountText(d) {
  const n = Number(d?.count);
  return Number.isInteger(n) && n > 0 ? String(n) : '';
}

// "用 AI 做课"页每步说明展开与否：用户点过（localStorage 'open' | 'closed'）以用户的为准；
//   没点过时课还没开始设计（status none 或没有状态）展开，否则收起
export function buildDescOpen(status, saved) {
  if (saved === 'open') return true;
  if (saved === 'closed') return false;
  return !status?.kind || status.kind === 'none';
}

// "用 AI 做课"页三步（G1 四步去掉"上传教案"）：标题与说明复用 LESSON_TEXT
export function buildSteps() {
  const T = LESSON_TEXT;
  return [
    { id: 'tool', title: T.guideToolStep, desc: T.guideToolDesc },
    { id: 'folder', title: T.guideFolderStep, desc: T.guideFolderDesc },
    { id: 'opening', title: T.guideOpeningStep, desc: T.guideOpeningDesc },
  ];
}

// "启动上课"页未运行时的四行提醒（只提醒，不拦）→ [{ id, tone: 'good'|'bad'|'warn'|'off', text, action? }]
//   action = { id: 'settings' | 'prepare' | 'check-open', label, title, focus? }：settings 去平台 → 设置（G4：密码搬到那里），
//   prepare 去第 4 步（focus 是那一节），check-open 打开检查对话框
//   G4 §3：环境一行（id 'env'）只显示状态、不放按钮（环境由工作台自动准备）；文字见 envCheckRow（当前课不需要时没有这一行）
export function classChecklist(o) {
  const setup = o?.setup ?? {};
  const rows = [];
  // S14：密码默认 123456 → 只提醒去改；旧 overview 没有 password 时按 passwordSet 推断
  const pw = setup.password ?? (setup.passwordSet ? 'set' : 'default');
  rows.push(pw === 'set'
    ? { id: 'password', tone: 'good', text: '教师密码已设' }
    : { id: 'password', tone: 'warn', text: '教师密码是默认的 123456', action: { id: 'settings', label: '去改', title: '到平台 → 设置换一个教师密码', focus: 'TEACHER_PASSWORD' } });
  const notice = checkNotice(o?.check);
  if (notice) rows.push({ id: 'check', tone: notice.tone, text: notice.text, action: { id: 'check-open', label: '查看', title: '看看是哪几处，可以复制给 AI 让它照着改' } });
  else if (o?.check) rows.push({ id: 'check', tone: 'good', text: '课程检查没有发现问题' });
  else rows.push({ id: 'check', tone: 'off', text: '还没有检查课程' });
  const env = envCheckRow(o);
  if (env) rows.push(env);
  const n = o?.currentLesson?.data?.roster ?? 0;
  rows.push(n
    ? { id: 'roster', tone: 'good', text: `名单 ${n} 人` }
    : { id: 'roster', tone: 'off', text: '没有名单，学生会自己输名字', action: { id: 'prepare', label: '导入名单', title: '到"上课准备"页签导入这门课的名单', focus: 'roster' } });
  return rows;
}

// ===== G4 收尾：课程要用的环境（工作台课程与平台两区重构规格 §3.1、§3.2、§3.4）=====
// env = overview.env / SSE env / POST /api/env/retry 的 env：{ pyodide: { state, percent, label, error, diagnosis, neededBy, result, … } }
//   state：'unneeded'（没有课需要）| 'ready' | 'preparing' | 'failed'（需要、缺、没在下载）；现在只有 pyodide 一种
const normCfg = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '');
const pyOf = (env) => env?.pyodide ?? null;
const needsRow = (py, rel) => Boolean(py && rel && (py.neededBy ?? []).some((p) => normCfg(p) === normCfg(rel)));

// overview → { needed, state }：当前课（currentLesson.path，没有时 lesson.path）在不在 neededBy 里
export function envCurrent(o) {
  const py = pyOf(o?.env);
  const rel = o?.currentLesson?.path ?? o?.lesson?.path ?? null;
  return { needed: needsRow(py, rel), state: py?.state ?? 'unneeded' };
}

// 第 4 步 #c-env 与第 5 步提醒的环境一行（只读，不放按钮）；当前课不需要 → null
export function envCheckRow(o) {
  const { needed, state } = envCurrent(o);
  if (!needed) return null;
  const py = pyOf(o.env);
  if (state === 'ready') return { id: 'env', tone: 'good', text: 'Python 环境已准备好' };
  if (state === 'preparing') return { id: 'env', tone: 'off', text: `Python 环境正在准备（${py.percent ?? 0}%）` };
  return { id: 'env', tone: 'warn', text: py.error ? `Python 环境没准备好：${py.error}` : 'Python 环境还没准备好' };
}

// 平台 → 环境与版本的状态行 → { dot, text, retry, diagnosis }（retry：显示"重试"；diagnosis：S12 排障行）
export function envLine(env) {
  const py = pyOf(env);
  const base = { retry: false, diagnosis: null };
  switch (py?.state) {
    case 'ready':
      return { dot: 'good', text: '已就绪', ...base };
    case 'preparing':
      return { dot: 'busy', text: `正在准备 ${py.percent ?? 0}%${py.label ? `（${py.label}）` : ''}`, ...base };
    case 'failed':
      return { dot: 'bad', text: py.error ? `没准备好：${py.error}` : '没准备好', retry: true, diagnosis: py.diagnosis ?? null };
    default:
      return { dot: 'off', text: '没有课程需要', ...base };
  }
}

// 顶栏状态区：正在准备时一句，其它 null
export function envTopText(env) {
  const py = pyOf(env);
  return py?.state === 'preparing' ? `正在准备 Python 环境 ${py.percent ?? 0}%` : null;
}

// 横幅 #p-env → null | { kind: 'ok', text, at } | { kind: 'restart', text } | { kind: 'failed', text, diagnosis }
//   restart：平台运行中、启动时环境缺（platform.envWarning）而现在准备好了 → 重启后生效（不随"知道了"收起）；
//   ok：最近一次下载成功（result.at）且没点过"知道了"（dismissedAt = 点"知道了"时那次的 at）；
//   failed：下载失败有原因（还没试过的 failed 没有原因，不出横幅）；
//   preparing：平台运行中且当前课要（needed = envCurrent(o).needed）或启动时环境缺 → 进度一句，没有按钮
export function envBanner(env, { platform = null, dismissedAt = null, needed = false } = {}) {
  const py = pyOf(env);
  if (!py) return null;
  // G4 收尾：平台运行中、当前课要（或启动时就缺）而正在准备 → 一条只读横幅（顶栏仍显示进度）
  if (py.state === 'preparing') {
    if (platform?.state === 'running' && (needed || platform.envWarning)) {
      return { kind: 'preparing', text: `正在准备 Python 环境 ${py.percent ?? 0}%，写程序的段准备好后重启平台生效` };
    }
    return null;
  }
  if (py.state === 'ready') {
    if (platform?.state === 'running' && platform.envWarning) return { kind: 'restart', text: 'Python 环境已准备好，重启平台后生效' };
    if (py.result?.ok && py.result.at !== dismissedAt) return { kind: 'ok', text: 'Python 环境已准备好', at: py.result.at };
    return null;
  }
  if (py.state === 'failed' && py.error) return { kind: 'failed', text: `Python 环境没准备好：${py.error}`, diagnosis: py.diagnosis ?? null };
  return null;
}

// S19：横幅 #p-share——平台文件夹在网络共享里（overview.networkShare，服务端 network-share.js）→ { text }，否则 null；
//   路径超过 60 字符时中间省略（保留开头与结尾，共 60 字符）
const SHARE_PATH_MAX = 60;
function middleClip(s, max = SHARE_PATH_MAX) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  const tail = Math.floor((max - 1) / 2);
  return `${t.slice(0, max - 1 - tail)}…${t.slice(t.length - tail)}`;
}
export function shareBanner(overview) {
  const share = overview?.networkShare;
  if (!share?.path) return null;
  return { text: `平台文件夹在网络共享里（${middleClip(share.path)}），上课记录可能保存不稳。建议把整个文件夹拷到这台电脑的磁盘上，再从那里双击工作台。` };
}

// "重试""导入整包"（POST /api/env/retry → { started, env }）之后的提示
export function envRetryText(r) {
  if (r?.started) return '开始准备 Python 环境';
  const py = pyOf(r?.env);
  if (py?.state === 'preparing') return '正在准备，等它完成';
  if (py?.state === 'ready') return 'Python 环境已就绪';
  if (py?.state === 'failed' && py.error) return py.error;
  return '现在没有课程需要 Python 环境';
}

// 删课确认框：这门课是唯一需要 Python 环境的课 → 删后会一起清理（服务端 cleanupEnvironments 同一规则；实际清没清看 DELETE 的 cleaned）
export function envCleansWith(env, row) {
  const py = pyOf(env);
  const needed = py?.neededBy ?? [];
  return needed.length > 0 && needed.every((p) => normCfg(p) === normCfg(row?.path));
}
