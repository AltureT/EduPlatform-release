// 工作台页面（管理台规格 §5；G3 管理台线性路径重设计规格 §2）：原生 JS（ES module），无依赖；fetch + EventSource
// 纯函数（页签圆标 tabMarks、侧栏课程 sideCourses、井号路由、失败后的下一步、文案）在 /ui-logic.js（scripts/manage/ui-logic.js，有单测）
// G3：顶栏当前课程（全局唯一）+ 平台状态；横幅区；左侧五步线性路径 + 数据 / 平台；主区七页，井号即页面（routeFor）
// G4（工作台两区重构规格 §1）：左栏两区——课程（五步 + 管理 + 数据）、平台（设置 + 环境与版本）；主区九页；
//   密码 / 端口 / AI 接口在平台 → 设置（#settings），第 4 步只剩名单、课前检查、链接
// G5（工作台侧栏常规化与页签步骤条规格）：左栏只做菜单——课程一门一条（sideCourses，点了设为当前课程）、新建课程（#new）、
//   全部课程（#courses，原"管理"）、数据；平台两项；底部排障文件（overview.diagnoses）与版本行（sideVersion）；顶栏下拉删除；
//   主区：课名标题行 + "…"菜单 + 一句状态（courseLead）+ 页签式步骤条（tabMarks，四页 #draft #build #prepare #class）；没有课程时"新建第一门课"卡
// G4 收尾（§3.1–§3.4）：课程要用的环境由工作台自动准备——overview.env / SSE env → 平台 → 环境与版本（#env-section）、顶栏一句、
//   横幅 #p-env、第 4 步 #c-env、第 5 步提醒；"重试""导入整包"都是 POST /api/env/retry（renderEnv）
import {
  tabMarks, courseLead, TAB_PAGES, routeFor, buildDescOpen, buildSteps, classChecklist, PAGES, sideCourses, sideVersion, diagCountText,
  passwordError,
  envCurrent, envCheckRow, envLine, envTopText, envBanner, envRetryText, envCleansWith,
  errorActions, backupSummary, fmtDate, fmtSize,
  splitAddresses, stateLabel, classroomLesson,
  checkSummary, checkNotice, checkItems, checkReportText, checkBandText,
  lessonCardStatus, lessonCardMeta, draftNote, lessonCardOps, uploadCheck, LESSON_TEXT, lessonName, nextCurrentAfterDelete,
  progressTableRows, PROGRESS_COLUMNS, lessonNextLead,
  platformFilesStatus, updateStatus, updateBandText, updateResultText, updateRecoveredText, UPDATE_TEXT,
  aiTestText,
  aiModelsText,
  lessonDataLine, lessonPickOptions, migratedText,
} from './ui-logic.js';

// ===== 访问凭据：从地址栏 t 取出后存 sessionStorage，并从地址栏移除 =====
const TOKEN = (() => {
  const u = new URL(location.href);
  const t = u.searchParams.get('t');
  if (t) {
    try { sessionStorage.setItem('manage-t', t); } catch { /* ignore */ }
    u.searchParams.delete('t');
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    return t;
  }
  try { return sessionStorage.getItem('manage-t') || ''; } catch { return ''; }
})();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
};
// localStorage 只放本机的小习惯（说明收展、备课进度展开）；读写失败（隐私模式等）按没存过处理
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const BUSY = new Set(['building', 'starting', 'stopping']);
let overview = null;
// G1：平台文件夹的绝对位置（overview.platformDir），"用 AI 做课"页第 2 步显示
let platformDir = null;
let platform = { state: 'stopped' };
let currentPage = null;
let logLines = [];
// R4 平台更新：update = overview / settings 的 update；updatedAway = 已更新成功、旧工作台即将退出（不再请求接口）
let update = null;
let updateChecking = false;
let updateArmed = false;
let updateArmTimer = null;
let updateLines = [];
let updatedAway = false;
let events = null;

// ===== 通用 =====
async function api(path, { method = 'GET', body } = {}) {
  if (updatedAway) throw new Error('链接已失效'); // 旧凭据随旧工作台一起失效，不再请求
  const res = await fetch(path, {
    method,
    headers: { 'X-Manage-Token': TOKEN, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    showFatal('工作台链接已失效。请回到启动工作台时打开的那个窗口，按提示重新打开工作台链接。');
    throw new Error('链接已失效');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '操作失败'), { data, status: res.status });
  return data;
}

function showFatal(msg) {
  const e = $('#fatal');
  e.textContent = msg;
  e.hidden = false;
}

let toastTimer = null;
function toast(msg, bad = false) {
  const e = $('#toast');
  e.textContent = msg;
  e.className = bad ? 'toast bad' : 'toast';
  e.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { e.hidden = true; }, bad ? 6000 : 3000);
}

function confirmDialog(text, okLabel) {
  const dlg = $('#confirm');
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

const setText = (sel, text) => { $(sel).textContent = text; };

async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    return r;
  } catch (err) {
    if (err.message !== '链接已失效') toast(err.message, true);
    return null;
  }
}

// 链接：有地址时可点（新标签打开），没有地址时去掉 href 变成普通文字
function setLink(a, url, text = url) {
  a.textContent = text;
  if (url) a.href = url;
  else a.removeAttribute('href');
}

const marks = () => tabMarks({ ...(overview ?? {}), platform });
const currentLesson = () => overview?.currentLesson ?? null;

// 当前该做的那一页（没有井号时、点侧栏的课、"继续 →"）= tabMarks 的 nextId；还没有课程 → 教案页（主区显示"新建第一门课"卡）
const nextPage = () => marks().nextId;

// ===== 页面：地址栏井号即页面（#new #draft #build #prepare #class #courses #data #settings #platform；旧井号见 routeFor） =====
let pendingFocus = null;
function showPage(page, { focus, lesson } = {}) {
  if (!PAGES.includes(page)) page = 'new';
  pendingFocus = focus || null;
  if (page === 'data' && lesson) dataLesson = lesson;
  const hash = page === 'data' && lesson ? `data?lesson=${encodeURIComponent(lesson)}` : page;
  if (location.hash === `#${hash}`) renderPage(hash);
  else location.hash = hash; // 触发 hashchange → renderPage
}
window.addEventListener('hashchange', () => renderPage(location.hash));

function renderPage(hash) {
  const r = routeFor(hash, overview ? nextPage() : null);
  if (r.focus) pendingFocus = r.focus;
  // 数据页：带 ?lesson= 就看那门课；不带（侧栏点"数据"）就复位回当前课、收起选课框
  if (r.page === 'data') {
    dataLesson = r.lesson ?? '';
    if (!dataLesson) $('#d-lesson').hidden = true;
  }
  // 空井号、#home、旧井号：地址栏换成新页面的井号（不留历史记录）
  const want = r.page === 'data' && r.lesson ? `#data?lesson=${encodeURIComponent(r.lesson)}` : `#${r.page}`;
  if (location.hash !== want) history.replaceState(null, '', want);
  currentPage = r.page;
  for (const s of $$('.page')) s.hidden = s.id !== `page-${r.page}`;
  markSide();
  renderCourseHead();
  renderCourseBits();
  // 窄屏页签条横向滚动：只把正在看的页签滚进视野（不滚到中间，免得第一个页签被截半）；页面随后回到顶部
  if (!$('#course-head').hidden) $(`.tabs a[data-page="${r.page}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (r.page === 'courses') loadLessons();
  if (r.page === 'draft') renderDraft();
  if (r.page === 'build') renderBuild(true);
  if (r.page === 'prepare') { loadRoster(); renderPrepChecks(); }
  if (r.page === 'class') renderClass();
  if (r.page === 'data') loadBackups();
  if (r.page === 'settings' || r.page === 'platform') loadSettings();
  window.scrollTo(0, 0);
  refresh();
}
// 侧栏：点当前页也重新渲染（井号没变不会触发 hashchange）
for (const a of $$('.side a[data-page]')) {
  a.addEventListener('click', (e) => {
    if (location.hash === `#${a.dataset.page}`) {
      e.preventDefault();
      renderPage(location.hash);
    }
  });
}

// 页面里要聚焦的一节或一项（错误按钮"去设置密码""换一个端口"、上课页提醒"去设置""导入名单"、旧井号 #roster）
function applyFocus() {
  if (!pendingFocus) return;
  const f = pendingFocus;
  const section = { roster: '#prep-roster', 'l-title': '#l-title' }[f];
  let target = section ? $(section) : null;
  if (!target) {
    const form = $('#settings-form');
    target = form.elements[f] ?? null;
  }
  if (f === 'TEACHER_PASSWORD' && currentPage === 'settings') showPasswordEdit(true);
  if (!target || target.closest('[hidden]')) return;
  pendingFocus = null;
  target.scrollIntoView({ block: 'center' });
  if (typeof target.focus === 'function' && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.focus();
}

// ===== G5 侧栏（§1）：课程一门一条（≤ 8 门）+ 新建课程 / 全部课程 / 数据 + 平台两项；底部排障文件与版本行 =====
// lessonRows = /api/lessons/overview（全部课程页、侧栏、删课换课共用）；启动时、换课后、当前课变了（例如 AI 新建了课）时重新读
// 选中态：正在看的页面；课程条目在看这门课的步骤页（教案 / 做课 / 上课准备 / 启动上课）时选中
const COURSE_PAGES = TAB_PAGES;
function markSide() {
  for (const a of $$('.side [data-page]')) {
    if (a.dataset.page === currentPage) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  for (const b of $$('#side-courses [data-course]')) {
    if (b.dataset.current === '1' && COURSE_PAGES.includes(currentPage)) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}
let sideSig = '';
function renderSideCourses() {
  if (!lessonRows) return;
  const s = sideCourses(lessonRows);
  const count = $('#side-count');
  count.hidden = s.count === null;
  count.textContent = s.count === null ? '' : String(s.count);
  const sig = JSON.stringify(s.items);
  if (sig !== sideSig) {
    sideSig = sig;
    const ul = $('#side-courses');
    ul.textContent = '';
    ul.hidden = s.items.length === 0;
    for (const it of s.items) {
      const b = el('button', { type: 'button', className: 'nav', title: it.label },
        svgIcon('i-book'), el('span', { textContent: it.label }));
      b.dataset.course = it.dir;
      b.dataset.current = it.current ? '1' : '';
      b.addEventListener('click', () => pickCourse(it));
      ul.append(el('li', {}, b));
    }
  }
  markSide();
}
function svgIcon(id) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}
function renderSideFoot() {
  const n = diagCountText(overview?.diagnoses);
  $('#side-diag-n').hidden = !n;
  setText('#side-diag-n', n);
  const v = sideVersion(update);
  setText('#side-ver', v.text);
  $('#side-ver').classList.toggle('fresh', v.fresh);
}
$('#side-diag').addEventListener('click', () => run(() => api('/api/diagnosis/open', { method: 'POST' }), '已打开排障文件夹'));
// G5 §5 窄屏：左栏是抽屉——☰ 打开；点遮罩、点菜单里的一项（页面、课程、排障文件、版本行）或按 Esc 收起
function setSideOpen(on) {
  document.body.classList.toggle('side-open', on);
  $('#side-mask').hidden = !on;
  $('#side-toggle').setAttribute('aria-expanded', String(on));
  $('#side-toggle').title = on ? '收起菜单' : '打开菜单';
  if (on) $('#side .nav')?.focus();
}
$('#side-toggle').addEventListener('click', () => setSideOpen(!document.body.classList.contains('side-open')));
$('#side-mask').addEventListener('click', () => setSideOpen(false));
$('#side').addEventListener('click', (e) => {
  if (e.target.closest('.nav')) setSideOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('side-open')) {
    setSideOpen(false);
    $('#side-toggle').focus();
  }
});
function renderSide() {
  renderSideCourses();
  renderSideFoot();
  renderCourseHead();
}

// ===== G5 主区课名标题行与页签（§2.1、§2.2）：只在四个页签页、有当前课时显示 =====
function renderCourseHead() {
  const cl = currentLesson();
  const show = Boolean(cl) && TAB_PAGES.includes(currentPage);
  $('#course-head').hidden = !show;
  if (!show) {
    closeCourseMenu();
    return;
  }
  setText('#ch-title', cl.broken ? LESSON_TEXT.brokenTitle : cl.title || LESSON_TEXT.noTitle);
  setText('#ch-lead', courseLead({ ...overview, platform }));
  const MARK = { done: '✓', todo: '!' };
  for (const t of marks().tabs) {
    const a = $(`.tabs a[data-page="${t.id}"]`);
    const i = a.querySelector('.tab-mark');
    i.dataset.mark = t.mark;
    i.textContent = MARK[t.mark] ?? String(t.n);
    a.title = { done: '这一步做完了', todo: '这一步有要你做的事', wait: '还没到这一步' }[t.mark];
    if (t.id === currentPage) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  renderCourseMenu(cl);
}
// "…"菜单：复用全部课程页卡片的按钮（lessonCardOps）与动作（lessonAction）——重命名 / 打开文件夹 / 删除这门课
let menuSig = '';
function renderCourseMenu(cl) {
  const ops = cl.kind === 'mine' || cl.kind === 'example' ? lessonCardOps(cl).filter((op) => ['rename', 'open', 'delete'].includes(op.id)) : [];
  $('#ch-more').hidden = ops.length === 0;
  const sig = JSON.stringify([cl.dir, cl.title, ops.map((op) => op.id)]);
  if (sig === menuSig) return;
  menuSig = sig;
  const menu = $('#ch-menu');
  menu.textContent = '';
  for (const op of ops) {
    const b = el('button', { type: 'button', textContent: op.label, title: op.title, className: op.id === 'delete' ? 'danger' : '' });
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => {
      closeCourseMenu();
      lessonAction(op.id, cl);
    });
    menu.append(b);
  }
}
function closeCourseMenu() {
  $('#ch-menu').hidden = true;
  $('#ch-more').setAttribute('aria-expanded', 'false');
}
$('#ch-more').addEventListener('click', () => {
  const open = $('#ch-menu').hidden;
  $('#ch-menu').hidden = !open;
  $('#ch-more').setAttribute('aria-expanded', String(open));
  if (open) $('#ch-menu button')?.focus();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ch-more-wrap')) closeCourseMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#ch-menu').hidden) {
    closeCourseMenu();
    $('#ch-more').focus();
  }
});

// 当前课程的名字填进各页标题（.ln）；没有当前课 → 四个页签页与数据页的内容收起，主区只显示"新建第一门课"卡（G5 §2.3）
const NEED_COURSE = [...TAB_PAGES, 'data'];
function renderCourseBits() {
  const cl = currentLesson();
  const running = platform.state === 'running';
  for (const span of $$('.ln')) span.textContent = lessonName(cl);
  let empty = false;
  for (const s of $$('.page')) {
    // 上课页：平台在跑时（哪怕当前课已换走）照常显示上课面板
    const has = Boolean(cl) || (s.id === 'page-class' && running);
    for (const e of s.querySelectorAll('[data-need-course]')) e.hidden = !has;
    if (!has && s.id === `page-${currentPage}` && NEED_COURSE.includes(currentPage)) empty = true;
  }
  $('#no-course').hidden = !empty;
}

// ===== 课程检查（L1） =====
// 列表：徽标"问题 / 提醒" + 文件:行 + 一句话 + → 怎么改
function renderCheckList(ul, r) {
  ul.textContent = '';
  for (const it of checkItems(r)) {
    ul.append(el('li', { className: `check-item ${it.level}` },
      el('span', { className: 'check-badge', textContent: it.badge }),
      el('div', { className: 'check-body' },
        el('code', { className: 'check-where', textContent: it.where }),
        el('p', { className: 'check-msg', textContent: it.message }),
        ...(it.fix ? [el('p', { className: 'check-fix', textContent: `→ ${it.fix}` })] : []))));
  }
}

const lessonTitleOf = (r) => r?.lesson?.title ?? overview?.lesson?.title ?? null;
async function copyCheck(r, button) {
  if (!r) return;
  await copyText(checkReportText(r, { title: lessonTitleOf(r) }), button, '已复制检查结果，直接贴给帮你生成课程的 AI 就行');
}

let dialogCheck = null;
function openCheckDialog(r) {
  if (!r) return;
  dialogCheck = r;
  const s = checkSummary(r);
  setText('#check-dlg-title', lessonTitleOf(r) ? `课程检查 ·《${lessonTitleOf(r)}》` : '课程检查');
  setText('#check-dlg-summary', s.text);
  $('#check-dlg-summary').dataset.tone = s.tone;
  renderCheckList($('#check-dlg-list'), r);
  $('#check-dlg').showModal();
}
$('#check-dlg-copy').addEventListener('click', (e) => copyCheck(dialogCheck, e.currentTarget));
$('#p-check-copy').addEventListener('click', (e) => copyCheck(platform.check, e.currentTarget));
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-check-open]');
  if (!b || b.disabled) return;
  openCheckDialog(b.dataset.checkOpen === 'running' ? platform.check : overview?.check);
});

// "启动上课"页：当前课还没查过时后台查一次（每门课每次打开页面最多一次）
const autoChecked = new Set();
function autoCheck(path) {
  if (!path || autoChecked.has(path) || overview?.lesson?.error || platform.state !== 'stopped') return;
  autoChecked.add(path);
  api('/api/lesson/check', { method: 'POST', body: {} }).then(() => refreshSoon(), () => {});
}
$('#c-log').addEventListener('click', () => openDrawer());
$('#pf-log').addEventListener('click', () => openDrawer());

// 出错框里的按钮统一走这里
async function doAction(a, button) {
  switch (a.id) {
    case 'goto-settings': showPage('settings', { focus: a.field }); break;
    case 'new': showPage('new', { focus: 'l-title' }); break;
    case 'courses': showPage('courses'); break;
    case 'show-log': openDrawer(); break;
    case 'copy-check': await copyCheck(platform.error?.check, button); return; // 不刷新：按钮上的"已复制 ✓"要留一会儿
    case 'stop-old': {
      const ok = await confirmDialog(
        `将结束之前没关掉的平台（进程 ${a.pid}），然后用当前设置重新启动。\n正在连接的学生会断开，平台启动后刷新页面即可重新进入。`,
        '停止它并启动',
      );
      if (!ok) return;
      await run(() => api('/api/platform/start', { method: 'POST', body: { stopOld: a.pid } }), '正在停止之前的平台，然后启动…');
      break;
    }
    case 'use-port': {
      const r = await run(() => api('/api/settings', { method: 'PUT', body: { PORT: String(a.port) } }));
      if (!r) break;
      await run(() => api('/api/platform/start', { method: 'POST' }), `已改用端口 ${a.port}，正在启动…`);
      break;
    }
    default: {
      const fn = ACTIONS[a.id];
      if (fn) await fn();
    }
  }
  refreshSoon();
}

// ===== 顶栏平台状态 + 横幅区 =====
function renderPlatform(p) {
  platform = p;
  const s = p.state;
  // "还没有课程"的启动失败：新建课程以后就过时了，不再显示
  const err = p.error?.kind === 'no-lesson' && overview?.currentLesson ? null : p.error;
  $('#dot').className = `dot ${s === 'running' ? 'good' : s === 'stopped' ? (err ? 'bad' : 'off') : 'busy'}`;
  setText('#p-state', stateLabel({ ...p, error: err }));
  $('#p-spin').hidden = !BUSY.has(s);
  // 顶栏按钮：运行中"停止 / 重启"，准备中只"停止"（可以中途停下）；启动在第 5 步
  const show = (action, visible, enabled = visible) => {
    for (const b of $$(`.status-actions [data-action="${action}"]`)) {
      b.hidden = !visible;
      b.disabled = !enabled;
    }
  };
  show('stop', s !== 'stopped', s !== 'stopping');
  show('restart', s === 'running');
  for (const b of $$('#classroom [data-action]')) b.disabled = s !== 'running';
  for (const b of $$('[data-action="rebuild"]')) b.disabled = s !== 'stopped';
  // 运行中在顶栏直接给学生地址（可点，新标签打开）
  const primary = overview ? splitAddresses(overview.urls).primary : null;
  $('#p-addr-wrap').hidden = !(s === 'running' && primary);
  if (primary) setLink($('#p-addr'), primary);

  $('#p-error').hidden = !err;
  if (err) {
    setText('#p-error-msg', err.message);
    // 没有专门详情时，只有运行 / 构建类失败才拿最近日志当详情（端口、密码类失败显示旧日志会误导）
    const fromLog = ['crash', 'build', 'timeout', 'internal'].includes(err.kind) ? logLines.slice(-20) : [];
    const detail = err.detail && err.detail.length ? err.detail : fromLog;
    setText('#p-error-detail', detail.join('\n') || '（没有更多信息）');
    $('#p-error-details').hidden = detail.length === 0;
    // L1：课程有问题时逐条列出（文件:行 + 一句话 + 怎么改）
    const asList = err.kind === 'check' && err.check;
    $('#p-error-list').hidden = !asList;
    $('#p-error-detail').hidden = Boolean(asList);
    if (asList) renderCheckList($('#p-error-list'), { errors: err.check.errors, warnings: [] });
    const box = $('#p-error-actions');
    box.textContent = '';
    errorActions(err).forEach((a, i) => {
      const b = el('button', { type: 'button', textContent: a.label, className: i === 0 ? 'primary' : '', title: a.title || '' });
      b.addEventListener('click', () => doAction(a, b));
      box.append(b);
    });
    box.hidden = box.childElementCount === 0;
  }
  renderDiag($('#p-error-diag'), err ? p.diagnosis : null);
  // V1：检查有问题但照常启动了 → 横幅一行
  const band = err ? null : checkBandText(p);
  $('#p-check').hidden = !band;
  setText('#p-check-msg', band ?? '');
  $('#pending').hidden = !p.pendingRestart;
  renderResetDesc();
  renderSide();
  renderCourseBits();
  renderEnv();
  if (currentPage === 'class') renderClass();
  renderUpdate(); // 放最后：更新进行中把上面刚设好的启动 / 重启 / 重建按钮再禁用
}

// ===== G4 收尾：课程要用的环境（overview.env；SSE env 实时更新）=====
// 顶栏一句：正在准备 → "正在准备 Python 环境 N%"；否则平台启动时环境缺（platform.envWarning）且还没好 → 那句提醒（不是错误框）
// 横幅 #p-env（envBanner）：准备好（知道了）/ 运行中准备好了要重启（重启平台）/ 没准备好（重试 + 排障行）
// 平台 → 环境与版本：状态行 + 重试 + 排障行；第 4 步 #c-env、第 5 步提醒在各自的页面渲染时读 overview.env
const ENV_SEEN_KEY = 'env-ok-seen';
function renderEnv() {
  if (!overview) return;
  const env = overview.env;
  const ready = env?.pyodide?.state === 'ready';
  const note = envTopText(env) ?? (platform.envWarning && !ready ? platform.envWarning : null);
  $('#p-env-top').hidden = !note;
  setText('#p-env-top', note ?? '');
  $('#p-env-top').title = envTopText(env) && platform.envWarning ? platform.envWarning : '';

  const seen = Number(store.get(ENV_SEEN_KEY)) || null;
  const b = envBanner(env, { platform, dismissedAt: seen, needed: envCurrent(overview).needed });
  $('#p-env').hidden = !b;
  $('#p-env').dataset.at = b?.at ?? '';
  setText('#p-env-text', b?.text ?? '');
  $('#p-env-ok').hidden = b?.kind !== 'ok';
  $('#p-env-restart').hidden = b?.kind !== 'restart';
  $('#p-env-retry').hidden = b?.kind !== 'failed';
  renderDiag($('#p-env-diag'), b?.kind === 'failed' ? b.diagnosis : null);

  const line = envLine(env);
  $('#env-dot').className = `dot ${line.dot}`;
  setText('#env-state', line.text);
  $('#env-retry').hidden = !line.retry;
  renderDiag($('#env-diag'), line.diagnosis);

  renderSide();
  if (currentPage === 'prepare') renderPrepChecks();
  if (currentPage === 'class' && platform.state !== 'running') renderClass();
}
$('#p-env-ok').addEventListener('click', () => {
  store.set(ENV_SEEN_KEY, $('#p-env').dataset.at);
  renderEnv();
});
// "重试"（横幅、环境一节）与"导入整包"：拷来的压缩包放进 vendor/ 后，下载脚本的"本机文件"来源会先用它
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-env-retry]');
  if (!b || b.disabled) return;
  b.disabled = true;
  const r = await run(() => api('/api/env/retry', { method: 'POST' }));
  b.disabled = false;
  if (!r) return;
  toast(envRetryText(r));
  if (overview) overview.env = r.env;
  renderEnv();
});

function renderOverview(o) {
  overview = o;
  if (o.platformDir && o.platformDir !== platformDir) platformDir = o.platformDir;
  if (o.update) update = o.update;
  renderSideFoot();
  // M6：旧课堂数据刚按课程整理过（接口只给一次）→ 横幅一行，教师点"知道了"收起
  if (o.migrated) {
    setText('#p-migrated-text', migratedText(o.migrated));
    $('#p-migrated').hidden = false;
  }
  // 当前课变了（侧栏、全部课程页没经手的换课，例如 AI 用命令新建了课）→ 重读课程列表
  if (lessonRows && (o.lesson?.path ?? '') !== lessonRowsFor) loadLessons();
  renderPasswordState();
  renderPlatform({ ...o.platform, pendingRestart: o.pendingRestart });
  if (currentPage === 'draft') renderDraft();
  if (currentPage === 'build') renderBuild(false);
  if (currentPage === 'prepare') renderPrepChecks();
  applyFocus();
}

async function refresh() {
  const o = await run(() => api('/api/overview'));
  if (o) renderOverview(o);
}
let refreshTimer = null;
const refreshSoon = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 250);
};
// 运行中每 10 秒刷新上课页：已进入人数、"课程文件有更新"黄条
setInterval(() => {
  if (platform.state === 'running' && currentPage === 'class' && !document.hidden) refresh();
}, 10000);

// ===== 运行记录：只在抽屉里（最近 500 行） =====
function renderLog() {
  if ($('#drawer').hidden) return;
  const d = $('#drawer-log');
  d.textContent = logLines.join('\n') || '平台启动后这里会显示运行记录';
  d.scrollTop = d.scrollHeight;
}
function pushLog(line) {
  logLines.push(line);
  if (logLines.length > 500) logLines.shift();
  renderLog();
}
async function openDrawer() {
  const r = await run(() => api('/api/logs?lines=500'));
  if (r) logLines = r.lines;
  $('#drawer').hidden = false;
  renderLog();
}
$('#drawer-close').addEventListener('click', () => { $('#drawer').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#drawer').hidden = true; });

// ===== 实时事件 =====
function connectEvents() {
  const es = new EventSource(`/api/events?t=${encodeURIComponent(TOKEN)}`);
  events = es;
  es.addEventListener('platform', (e) => {
    const p = JSON.parse(e.data);
    const changed = p.state !== platform.state;
    renderPlatform(p);
    if (changed) refreshSoon();
  });
  es.addEventListener('log', (e) => pushLog(JSON.parse(e.data).line));
  // 准备页面的输出只进运行记录，页面上只显示状态文字与转圈
  es.addEventListener('build', (e) => pushLog(JSON.parse(e.data).line));
  // G4 收尾：环境状态（开始 / 进度变化 / 结束 / 需求变化）；状态一变（不是只有进度变）就刷新一次，侧栏、检查单跟着变
  es.addEventListener('env', (e) => {
    if (!overview) return;
    const before = overview.env?.pyodide?.state;
    overview.env = JSON.parse(e.data);
    renderEnv();
    if (overview.env?.pyodide?.state !== before) refreshSoon();
  });
  // R4：更新子进程的逐行进度、结束（done）、启动静默检查的结果（checked）
  es.addEventListener('update', (e) => {
    const d = JSON.parse(e.data);
    if (d.line !== undefined) {
      updateLines.push(d.line);
      if (updateLines.length > 200) updateLines.shift();
    }
    if (d.checked) {
      update = { ...(update ?? {}), latest: d.latest };
    }
    if (d.done) {
      update = { ...(update ?? {}), running: false, result: d };
      if (d.ok) {
        afterUpdated();
        return;
      }
      toast(updateResultText(d).text, true);
      refreshSoon();
    }
    renderUpdate();
  });
  es.onerror = () => {
    if (updatedAway) return;
    setText('#p-state', '与工作台的连接中断，正在重连…');
    $('#p-state').title = '若一直如此，说明启动工作台时打开的那个窗口已关闭';
    $('#dot').className = 'dot busy';
  };
  es.onopen = () => {
    $('#p-state').title = '';
    refreshSoon();
  };
}

// ===== 按钮动作 =====
const ACTIONS = {
  start: () => run(() => api('/api/platform/start', { method: 'POST' })),
  stop: () => run(() => api('/api/platform/stop', { method: 'POST' })),
  restart: () => run(() => api('/api/platform/restart', { method: 'POST' })),
  rebuild: () => run(() => api('/api/platform/rebuild', { method: 'POST' }), '开始重新构建页面，完成后再启动平台'),
  // 名单（第 4 步）作用于当前课（rosterQuery）；数据页的操作作用于数据页选中的课（lessonQuery）
  backup: async () => {
    await run(() => api(`/api/backups${lessonQuery()}`, { method: 'POST' }), (r) => LESSON_TEXT.backedUp(r.file));
    refreshSoon();
    loadBackups();
  },
  'roster-clear': async () => {
    if (!(await confirmDialog(LESSON_TEXT.clearConfirm(lessonName(currentLesson())), LESSON_TEXT.clearOk))) return;
    await run(() => api(`/api/roster/clear${rosterQuery()}`, { method: 'POST' }), LESSON_TEXT.cleared);
    loadRoster();
    refreshSoon();
  },
  'reset-bindings': async () => {
    if (!(await confirmDialog(LESSON_TEXT.bindConfirm(pickedName()), LESSON_TEXT.bindOk))) return;
    await run(() => api(`/api/roster/reset-bindings${lessonQuery()}`, { method: 'POST' }), LESSON_TEXT.bindDone);
  },
  reset: async () => {
    if (!(await confirmDialog(LESSON_TEXT.resetConfirm(pickedName(), pickedRunning()), LESSON_TEXT.resetOk))) return;
    await run(() => api(`/api/reset${lessonQuery()}`, { method: 'POST', body: { confirm: true } }), (r) => LESSON_TEXT.resetDone(r.snapshot));
    refreshSoon();
    loadBackups();
  },
  'unsorted-backup': async () => {
    await run(() => api('/api/backups?lesson=_unsorted', { method: 'POST' }), (r) => LESSON_TEXT.backedUp(r.file));
    loadBackups();
  },
  'unsorted-delete': async () => {
    if (!(await confirmDialog(LESSON_TEXT.unsortedDeleteConfirm, LESSON_TEXT.unsortedDeleteOk))) return;
    await run(() => api('/api/unsorted/delete', { method: 'POST', body: { confirm: true } }), LESSON_TEXT.unsortedDeleted);
    refreshSoon();
    loadBackups();
  },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const fn = ACTIONS[b.dataset.action];
  if (fn) fn();
});

// 复制按钮（data-copy）：127.0.0.1 属安全上下文，可用剪贴板接口；失败时退回选中文本复制；按钮上短暂显示"已复制 ✓"
async function copyText(text, button, done = `已复制：${text}`) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { value: text });
    (button?.closest('dialog') ?? document.body).append(ta); // 模态框打开时框外元素不可选
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(done);
  if (button && !button.dataset.copied) {
    button.dataset.copied = '1';
    button.classList.add('copied');
    const original = button.textContent;
    button.textContent = '已复制 ✓';
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
      delete button.dataset.copied;
    }, 1500);
  }
}
// S12：排障行（启动失败框、更新结果、下载结果共用）：diagnosis = { file, at } | null；同一份文件不重画（保留"已复制 ✓"）
function renderDiag(box, d) {
  const file = d?.file ?? '';
  box.hidden = !file;
  if ((box.dataset.file ?? '') === file) return;
  box.dataset.file = file;
  box.textContent = '';
  if (file) box.append($('#diag-tpl').content.cloneNode(true));
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-diag]');
  const file = b?.closest('[data-file]')?.dataset.file;
  if (!b || b.disabled || !file) return;
  if (b.dataset.diag === 'open') {
    await run(() => api('/api/diagnosis/open', { method: 'POST' }));
    return;
  }
  if (b.dataset.copied) return;
  const name = file.split('/').pop();
  try {
    const res = await fetch(`/api/diagnosis/${encodeURIComponent(name)}`, { headers: { 'X-Manage-Token': TOKEN } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '读不到排障文件');
    await copyText(await res.text(), b, '已复制，直接贴给 AI 工具就行');
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-copy]');
  if (!b || b.disabled || b.dataset.copied || !b.dataset.copy) return;
  copyText(b.dataset.copy, b);
});

// ===== 平台 → 设置：密码、端口、AI 接口（一个表单，控件用 form 属性归入；G4 从第 4 步搬来，保存逻辑不变） =====
let settings = null;
let pwEditing = false;
function showPasswordEdit(on) {
  pwEditing = on;
  renderPasswordState();
}
// 密码已设：只显示"已设置 · 改密码"，点开才出输入框（原向导第 1 步的交互）
function renderPasswordState() {
  const set = Boolean(overview?.setup?.passwordSet);
  $('#pw-summary').hidden = !set || pwEditing;
  $('#pw-edit').hidden = set && !pwEditing;
}
$('#pw-change').addEventListener('click', () => {
  showPasswordEdit(true);
  $('#f-pw').value = '';
  $('#f-pw').focus();
});

async function loadSettings() {
  const s = await run(() => api('/api/settings'));
  if (!s) return;
  settings = s;
  const f = $('#settings-form');
  f.elements.TEACHER_PASSWORD.value = s.values.TEACHER_PASSWORD;
  f.elements.PORT.value = s.values.PORT;
  f.elements.AI_BASE_URL.value = s.values.AI_BASE_URL;
  f.elements.AI_MODEL.value = s.values.AI_MODEL;
  f.elements.AI_API_KEY.value = '';
  setText('#key-current', s.values.AI_API_KEY ? `当前密钥：${s.values.AI_API_KEY}` : '当前没有密钥');
  // K8：备用 AI 接口（已填时展开那一节）
  f.elements.AI_BASE_URL_2.value = s.values.AI_BASE_URL_2 ?? '';
  f.elements.AI_MODEL_2.value = s.values.AI_MODEL_2 ?? '';
  f.elements.AI_API_KEY_2.value = '';
  setText('#key-current-2', s.values.AI_API_KEY_2 ? `当前密钥：${s.values.AI_API_KEY_2}` : '当前没有密钥');
  if (s.values.AI_BASE_URL_2 || s.values.AI_MODEL_2 || s.values.AI_API_KEY_2) $('#ai-backup').open = true;
  setText('#ai-test-1-msg', '');
  setText('#ai-test-2-msg', '');
  // K9：重新载入设置时清掉上次获取的模型名单与提示
  for (const w of [1, 2]) {
    $(`#ai-models-${w}`).replaceChildren();
    setText(`#ai-models-${w}-msg`, '');
  }
  $('#f-runtime-url').value = s.values.RUNTIME_ZIP_URL ?? '';
  if (s.values.RUNTIME_ZIP_URL) $('#s-py-source').open = true;
  if (s.update) update = s.update;
  renderUpdate();
  // K7：版本与平台文件是否被改过（改动清单只放 title）
  const pf = platformFilesStatus(s.platformFiles);
  setText('#s-version', pf.version);
  setText('#s-pf-state', pf.label);
  $('#s-pf-state').title = pf.title;
  $('#s-pf-dot').className = `dot ${pf.dot}`;
  $('#s-pf-help').hidden = !pf.changed;
  $('#s-pf-more').hidden = !pf.changed;
  updatePortHint();
  clearErrors();
  setText('#settings-msg', '');
  applyFocus();
}
function clearErrors() {
  for (const e of $$('[data-err]')) e.textContent = '';
}
function updatePortHint() {
  const p = Number($('#f-port').value);
  $('#port-hint').hidden = !(settings?.lowPortNeedsAdmin && p > 0 && p < 1024);
}
$('#f-port').addEventListener('input', updatePortHint);
$('#show-pw').addEventListener('change', (e) => {
  $('#f-pw').type = e.target.checked ? 'text' : 'password';
});
$('#f-pw').addEventListener('input', () => { $('[data-err="TEACHER_PASSWORD"]').textContent = ''; });

async function saveSettings(patch) {
  clearErrors();
  const msg = $('#settings-msg');
  const okText = () => (platform.state === 'stopped' ? '已保存，下次启动平台时生效。' : '已保存，重启平台后生效。');
  try {
    const r = await api('/api/settings', { method: 'PUT', body: patch });
    renderPlatform({ ...platform, pendingRestart: r.pendingRestart });
    if ('TEACHER_PASSWORD' in patch) pwEditing = false;
    await loadSettings();
    msg.className = 'msg';
    msg.textContent = okText();
    refreshSoon();
  } catch (err) {
    msg.className = 'msg bad';
    msg.textContent = err.data?.errors ? (err.data.errors._ || '有几项需要修改，见红字提示') : err.message;
    for (const [k, v] of Object.entries(err.data?.errors || {})) {
      const e = $(`[data-err="${k}"]`);
      if (e) e.textContent = v;
    }
  }
}
$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const patch = {
    PORT: f.PORT.value,
    AI_BASE_URL: f.AI_BASE_URL.value.trim(),
    AI_MODEL: f.AI_MODEL.value.trim(),
    AI_BASE_URL_2: f.AI_BASE_URL_2.value.trim(),
    AI_MODEL_2: f.AI_MODEL_2.value.trim(),
  };
  // 密码：输入框打开着才提交（已设且没点"改密码"时不动）；还没设又没填时不提交，不挡住其它项的保存
  if (!$('#pw-edit').hidden) {
    const pw = f.TEACHER_PASSWORD.value;
    const set = Boolean(overview?.setup?.passwordSet);
    if (pw !== '' || set) {
      const bad = passwordError(pw);
      if (bad) {
        $('[data-err="TEACHER_PASSWORD"]').textContent = bad;
        $('#f-pw').focus();
        return;
      }
      patch.TEACHER_PASSWORD = pw;
    }
  }
  if (f.AI_API_KEY.value !== '') patch.AI_API_KEY = f.AI_API_KEY.value.trim();
  if (f.AI_API_KEY_2.value !== '') patch.AI_API_KEY_2 = f.AI_API_KEY_2.value.trim();
  saveSettings(patch);
});
// K8：两个"测一下"——用表单里当前的值（密钥留空时服务端用已保存的），不保存设置
for (const b of $$('[data-ai-test]')) {
  b.addEventListener('click', async () => {
    const which = Number(b.dataset.aiTest);
    const f = $('#settings-form').elements;
    const sfx = which === 2 ? '_2' : '';
    const msg = $(`#ai-test-${which}-msg`);
    b.disabled = true;
    msg.className = 'msg';
    msg.textContent = '正在测…';
    try {
      const r = await api('/api/ai/test', {
        method: 'POST',
        body: {
          which,
          baseUrl: f[`AI_BASE_URL${sfx}`].value.trim(),
          model: f[`AI_MODEL${sfx}`].value.trim(),
          apiKey: f[`AI_API_KEY${sfx}`].value.trim(),
        },
      });
      msg.className = r.ok ? 'msg' : 'msg bad';
      msg.textContent = aiTestText(r);
    } catch (err) {
      msg.className = 'msg bad';
      msg.textContent = `没通：${err.message}`;
    } finally {
      b.disabled = false;
    }
  });
}
// K9：两个"获取模型"——用表单里的地址（密钥留空时服务端用已保存的）列模型，填进 datalist；输入框仍可手填，不替教师选
for (const b of $$('[data-ai-models]')) {
  b.addEventListener('click', async () => {
    const which = Number(b.dataset.aiModels);
    const f = $('#settings-form').elements;
    const sfx = which === 2 ? '_2' : '';
    const input = f[`AI_MODEL${sfx}`];
    const list = $(`#ai-models-${which}`);
    const msg = $(`#ai-models-${which}-msg`);
    b.disabled = true;
    msg.className = 'msg';
    msg.textContent = '正在获取…';
    try {
      const r = await api('/api/ai/models', {
        method: 'POST',
        body: {
          which,
          baseUrl: f[`AI_BASE_URL${sfx}`].value.trim(),
          apiKey: f[`AI_API_KEY${sfx}`].value.trim(),
        },
      });
      const models = r.ok && Array.isArray(r.models) ? r.models : [];
      list.replaceChildren(...models.map((id) => {
        const o = document.createElement('option');
        o.value = id;
        return o;
      }));
      msg.className = models.length ? 'msg' : 'msg bad';
      msg.textContent = aiModelsText(r);
      // 输入框为空时聚焦，让下拉展开（有内容时不动，免得打断教师）
      if (models.length && input.value.trim() === '') {
        input.focus();
        try {
          input.showPicker?.(); // 有的浏览器聚焦不展开 datalist；不支持或没有用户手势时忽略
        } catch {}
      }
    } catch (err) {
      msg.className = 'msg bad';
      msg.textContent = err.message;
    } finally {
      b.disabled = false;
    }
  });
}
// 平台 → 环境与版本 → 环境的下载源（高级）：只写 RUNTIME_ZIP_URL，下次下载时生效，不影响平台（不提示重启）
$('#s-runtime-save').addEventListener('click', async () => {
  const msg = $('#s-runtime-msg');
  const err = $('[data-err="RUNTIME_ZIP_URL"]');
  err.textContent = '';
  try {
    await api('/api/settings', { method: 'PUT', body: { RUNTIME_ZIP_URL: $('#f-runtime-url').value.trim() } });
    msg.className = 'msg';
    msg.textContent = '已保存，下次下载时生效。';
  } catch (e) {
    msg.className = 'msg bad';
    msg.textContent = e.data?.errors ? '地址需要修改，见红字提示' : e.message;
    err.textContent = e.data?.errors?.RUNTIME_ZIP_URL ?? '';
  }
});
$('#clear-key').addEventListener('click', async () => {
  if (!(await confirmDialog('清空后，用到 AI 的功能将无法使用，需要重新填写密钥。', '清空密钥'))) return;
  saveSettings({ AI_API_KEY: '' });
});
$('#clear-key-2').addEventListener('click', async () => {
  if (!(await confirmDialog('清空后，主接口出问题时就没有备用接口可以改用了。', '清空密钥'))) return;
  saveSettings({ AI_API_KEY_2: '' });
});

// ④ 上课准备：课前检查（课程检查一行；环境一行 #c-env 只读，envCheckRow，当前课不需要时不显示）
function renderPrepChecks() {
  if (!overview) return;
  const env = envCheckRow(overview);
  $('#c-env').hidden = !env;
  if (env) {
    $('#c-env').dataset.tone = env.tone;
    $('#c-env .c-mark').textContent = { good: '✓', bad: '!', warn: '!', off: '·' }[env.tone];
    setText('#c-env-text', env.text);
  }
  const s = checkSummary(overview.check);
  setText('#c-check-text', overview.check ? (checkNotice(overview.check) ? s.text : '课程检查没有发现问题') : '还没有检查课程');
  $('#c-check').dataset.tone = overview.check ? s.tone : 'off';
  $('#c-check .c-mark').textContent = { good: '✓', bad: '!', warn: '!', off: '·' }[$('#c-check').dataset.tone];
  $('#c-check-open').hidden = !checkNotice(overview.check);
}
$('#c-check-run').addEventListener('click', (e) => checkCurrent(e.currentTarget));

// ===== ⑤ 启动上课：未运行 = 四行提醒 + 启动平台；运行中 = 上课面板 =====
function renderClass() {
  if (!overview) return;
  const running = platform.state === 'running';
  $('#c-start').hidden = running;
  $('#classroom').hidden = !running;
  if (running) {
    renderClassroom();
    return;
  }
  const o = { ...overview, platform };
  if (overview.currentLesson && !overview.check) autoCheck(overview.lesson?.path);
  const ul = $('#c-checks');
  ul.textContent = '';
  const MARK = { good: '✓', bad: '!', warn: '!', off: '·' };
  for (const r of classChecklist(o)) {
    const li = el('li', {}, el('span', { className: 'c-mark', textContent: MARK[r.tone] ?? '·', ariaHidden: 'true' }), el('span', { className: 'c-text', textContent: r.text }));
    li.dataset.tone = r.tone;
    if (r.action) {
      const b = el('button', { type: 'button', className: 'linkish', textContent: r.action.label, title: r.action.title });
      b.addEventListener('click', () => {
        if (r.action.id === 'check-open') openCheckDialog(overview?.check);
        else showPage(r.action.id === 'settings' ? 'settings' : 'prepare', { focus: r.action.focus });
      });
      li.append(b);
    }
    ul.append(li);
  }
  const busy = BUSY.has(platform.state);
  $('#c-start-btn').hidden = busy;
  $('#c-start-btn').disabled = platform.state !== 'stopped';
  $('#c-busy').hidden = !busy;
  setText('#c-busy-text', busy ? stateLabel(platform) : '');
}

function renderClassroom() {
  const o = overview;
  const { primary, others } = splitAddresses(o.urls);
  setLink($('#c-addr'), primary, primary || '没有找到局域网，请先连上 WiFi');
  $('#c-copy').hidden = !primary;
  $('#c-copy').dataset.copy = primary || '';
  $('#c-qr').innerHTML = o.urls.qr || ''; // 服务端 qr.js 生成的 SVG（只含 rect / path）
  $('#c-qr').hidden = !o.urls.qr;
  $('#c-others-box').hidden = others.length === 0;
  setText('#c-others-n', String(others.length));
  const ul = $('#c-others');
  ul.textContent = '';
  for (const u of others) {
    const a = el('a', { className: 'url', href: u, target: '_blank', rel: 'noopener', textContent: u, title: '在新标签打开' });
    const copy = el('button', { type: 'button', className: 'small', textContent: '复制', title: '复制这个地址' });
    copy.dataset.copy = u;
    ul.append(el('li', {}, a, copy));
  }
  // 平台正在跑的课（启动时记录）；.env 已换课时提示"已换成《…》，重启后生效"
  const cl = classroomLesson(o);
  setText('#c-lesson', cl.title);
  setText('#c-lesson-meta', cl.meta);
  setText('#c-lesson-next', cl.next);
  $('#c-lesson-next').hidden = !cl.next;
  setText('#c-students', String(o.data.students));
  setLink($('#c-teacher'), o.urls.teacher, '打开教师端');
  $('#c-stale').hidden = !o.build?.stale;
  // 更多信息（折叠）：这里可以放技术信息
  setText('#m-py', envLine(o.env).text);
  setText('#m-db', o.data.custom ? LESSON_TEXT.dbCustom(fmtSize(o.data.dbSize)) : fmtSize(o.data.dbSize));
  setText('#m-roster', LESSON_TEXT.rosterCount(o.data.rosterCount));
  setText('#m-backup', o.data.lastBackup ? fmtDate(o.data.lastBackup.mtime) : '还没有备份');
  setText('#m-dir', cl.dir);
  // L1：正在上的课启动前的检查结果；有提醒时给"查看"
  const pc = platform.check;
  setText('#m-check', checkSummary(pc).text);
  $('#m-check-open').hidden = !checkNotice(pc);
}

// ===== 名单（第 4 步，只对当前课）/ 数据页（当前课，"看别的课的数据"可换，只影响本页）（M6）=====
// 当前课目录：根目录开发课 '' → '.'
const dirParam = (dir) => (dir === '' ? '.' : dir);
const rosterQuery = () => {
  const cl = currentLesson();
  return cl && typeof cl.dir === 'string' ? `?lesson=${encodeURIComponent(dirParam(cl.dir))}` : '';
};
// 数据页：dataLesson = 选过的课程目录（'' = 当前课）；pickValue = 实际选中的
let dataLesson = '';
let pickRows = [];
let pickValue = '';
const lessonQuery = () => (pickValue ? `?lesson=${encodeURIComponent(pickValue)}` : '');
const runningDirOf = (o) => (o?.platform?.state === 'running' && o.runningLesson ? o.runningLesson.dir ?? null : null);
function pickedRow() {
  if (pickValue === '.') {
    const l = runningDirOf(overview) === '' ? overview?.runningLesson : overview?.lesson;
    return { title: l?.title, id: l?.id };
  }
  return pickRows.find((r) => r.dir === pickValue) ?? null;
}
const pickedName = () => lessonName(pickedRow());
function pickedRunning() {
  const rd = runningDirOf(overview);
  return rd !== null && (pickValue === rd || (rd === '' && pickValue === '.'));
}
async function loadLessonPick() {
  if (!overview) await refresh();
  const rows = await run(() => api('/api/lessons/overview'));
  if (rows) pickRows = rows;
  const currentDir = overview?.lesson?.dir ?? null;
  const devTitle = overview?.lesson?.title ?? null;
  // 缺省跟当前课（不跟正在跑的课：第 4 步与数据页都围绕当前课）
  const { options, selected } = lessonPickOptions(pickRows, { runningDir: runningDirOf(overview), currentDir, devTitle, picked: dataLesson || (currentDir === '' ? '.' : currentDir ?? '') });
  const box = $('#d-lesson');
  box.textContent = '';
  for (const o of options) box.append(el('option', { value: o.value, textContent: o.label }));
  box.value = selected;
  pickValue = selected;
  // 看的不是当前课时，选课框一直显示
  if (dataLesson && dataLesson !== dirParam(currentDir ?? '')) box.hidden = false;
  setText('.ln-data', pickedName());
  renderResetDesc();
}
$('#d-other').addEventListener('click', () => {
  const box = $('#d-lesson');
  box.hidden = !box.hidden;
  if (!box.hidden) box.focus();
});
$('#d-lesson').addEventListener('change', (e) => {
  dataLesson = e.target.value;
  // 地址栏跟着改（不触发 hashchange），刷新页面仍是这门课
  history.replaceState(null, '', `#data?lesson=${encodeURIComponent(dataLesson)}`);
  loadBackups();
});

let previewNames = null;
async function loadRoster() {
  if (!overview) await refresh();
  if (!currentLesson()) return;
  try {
    const r = await api(`/api/roster${rosterQuery()}`);
    setText('#r-status', LESSON_TEXT.rosterStatus(r.count, r.bound));
    setText('#r-names', r.names.slice(0, 20).join('、') + (r.count > 20 ? LESSON_TEXT.rosterMore(r.count) : ''));
  } catch (err) {
    setText('#r-status', err.message);
    setText('#r-names', '');
  }
}
$('#r-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  // Excel 另存的 CSV 常是 GBK 编码：UTF-8 解出乱码时改用 GB18030
  if (text.includes('�')) {
    try { text = new TextDecoder('gb18030').decode(buf); } catch { /* 保留 UTF-8 结果 */ }
  }
  $('#r-text').value = text;
  e.target.value = '';
  doPreview();
});
async function doPreview() {
  const r = await run(() => api('/api/roster/preview', { method: 'POST', body: { text: $('#r-text').value } }));
  if (!r) return;
  previewNames = r.names;
  $('#r-preview-box').hidden = false;
  setText('#r-preview-count', LESSON_TEXT.previewCount(r.count));
  setText('#r-preview-names', r.names.slice(0, 20).join('、') + (r.count > 20 ? ' …' : ''));
  $('#r-preview-ask').hidden = r.count === 0;
  $('#r-import').hidden = r.count === 0;
}
$('#r-preview').addEventListener('click', doPreview);
$('#r-cancel').addEventListener('click', () => {
  $('#r-preview-box').hidden = true;
  $('#r-text').focus();
});
$('#r-text').addEventListener('input', () => { $('#r-preview-box').hidden = true; });
$('#r-import').addEventListener('click', async () => {
  if (!previewNames?.length) return;
  const r = await run(() => api(`/api/roster${rosterQuery()}`, { method: 'POST', body: { names: previewNames } }), (x) => LESSON_TEXT.imported(x.count));
  if (r) {
    $('#r-preview-box').hidden = true;
    $('#r-text').value = '';
    loadRoster();
    refreshSoon();
  }
});

function renderResetDesc() {
  setText('#reset-desc', LESSON_TEXT.resetDesc(pickedRunning()));
}
function backupItem(b, { lesson, restoreLabel, restoreTitle }) {
  const T = LESSON_TEXT;
  const dl = el('button', { type: 'button', className: 'small', textContent: T.download, title: T.downloadTitle });
  dl.addEventListener('click', () => download(b.file, lesson));
  const rs = el('button', { type: 'button', className: 'small danger', textContent: restoreLabel, title: restoreTitle });
  rs.addEventListener('click', () => restoreBackup(b, lesson));
  return el('li', {},
    el('div', { className: 'backup-text' },
      el('span', { textContent: backupSummary(b) }),
      el('span', { className: 'file-name', textContent: b.file })),
    el('div', { className: 'backup-ops' }, dl, rs));
}
async function loadBackups() {
  await loadLessonPick();
  if (!currentLesson()) return;
  const T = LESSON_TEXT;
  const list = await run(() => api(`/api/backups${lessonQuery()}`));
  if (!list) return;
  const ul = $('#b-list');
  ul.textContent = '';
  $('#b-empty').hidden = list.length > 0;
  for (const b of list) ul.append(backupItem(b, { lesson: pickValue, restoreLabel: T.restore, restoreTitle: T.restoreTitle }));
  // 未归类的旧数据（升级前留下、看不出属于哪门课）：有才显示；旧备份可恢复到上面选中的课
  const u = overview?.data?.unsorted ?? { db: false, backups: 0 };
  $('#u-card').hidden = !u.db && !u.backups;
  $('#u-db').hidden = !u.db;
  const ulist = $('#u-list');
  ulist.textContent = '';
  if (!u.backups) return;
  const old = await run(() => api('/api/backups?lesson=_unsorted'));
  for (const b of old ?? []) {
    ulist.append(backupItem(b, { lesson: '_unsorted', restoreLabel: T.unsortedRestore(pickedName()), restoreTitle: T.unsortedRestoreTitle }));
  }
}
async function download(file, lesson) {
  try {
    const q = lesson ? `?lesson=${encodeURIComponent(lesson)}` : '';
    const res = await fetch(`/api/backups/${encodeURIComponent(file)}${q}`, { headers: { 'X-Manage-Token': TOKEN } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || LESSON_TEXT.downloadFailed);
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: file });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    toast(err.message, true);
  }
}
// 恢复到选中的课：这门课正在上 → 先停止平台；未归类备份（lesson = '_unsorted'）带 to；
//   备份里记的课与选中课不同 → 对话框多一句"这份备份来自《X》，确定恢复到《Y》？"
async function restoreBackup(b, lesson) {
  const T = LESSON_TEXT;
  if (pickedRunning()) {
    toast(T.restoreRunning, true);
    return;
  }
  const target = pickedRow();
  const fromRow = b.lessonId ? pickRows.find((r) => r.id === b.lessonId) : null;
  const differs = Boolean(b.lessonId) && b.lessonId !== target?.id;
  const text = T.restoreConfirm(b.file, lessonName(target)) + (differs ? `\n${T.restoreFrom(fromRow ? lessonName(fromRow) : T.otherLesson, lessonName(target))}` : '');
  if (!(await confirmDialog(text, T.restoreOk))) return;
  const unsorted = lesson === '_unsorted';
  // 已在确认框里问过来源：普通课也带 allowOther，避免服务端 409 后再问一次
  const body = unsorted ? { to: pickValue, allowOther: differs } : { allowOther: differs };
  const q = `?lesson=${encodeURIComponent(lesson || pickValue)}`;
  let r;
  try {
    r = await api(`/api/backups/${encodeURIComponent(b.file)}/restore${q}`, { method: 'POST', body });
  } catch (err) {
    // 服务端核对来源不符（页面没认出来的情况）：再问一次
    if (err.status === 409 && err.data?.from && (await confirmDialog(err.message, T.restoreOk))) {
      r = await run(() => api(`/api/backups/${encodeURIComponent(b.file)}/restore${q}`, { method: 'POST', body: { ...(body ?? {}), allowOther: true } }));
    } else if (err.message !== '链接已失效') toast(err.message, true);
  }
  if (r) toast(T.restored(r.snapshot));
  loadBackups();
  refreshSoon();
}

// ===== 课程（① 新建课程、管理（我的课程列表）、② 上传教案、③ 用 AI 做课；发布包与课程管理规格 §4，G3 §2.3.1–§2.3.3，G4 §1） =====
// 课程目录 lessons/<名> → 接口 /api/lessons/lessons/<名>/…（两段都编码，目录名不含分隔符）
const lessonUrl = (row, tail = '') => `/api/lessons/${row.dir.split('/').map(encodeURIComponent).join('/')}${tail}`;
// 上传教案、复制开场话只对我的课（示例课、根目录开发课不行）
const isMine = (row) => row?.kind === 'mine';
let lessonRows = null;
let lessonRowsFor = '';

// 课程列表（侧栏 + 全部课程页）：lessonRowsFor = 读的时候的当前课
async function loadLessons() {
  const asked = overview?.lesson?.path ?? '';
  const rows = await run(() => api('/api/lessons/overview'));
  if (!rows) return false;
  lessonRows = rows;
  lessonRowsFor = asked;
  renderSideCourses();
  if (currentPage === 'courses') renderLessons();
  return true;
}

// G5 侧栏的课：点了设为当前课程（平台运行中换课，重启后生效），再去这门课当前该做的那一步；读不出来的课去全部课程页
async function pickCourse(item) {
  const T = LESSON_TEXT;
  const row = (lessonRows ?? []).find((x) => x.dir === item.dir);
  if (!row || row.broken) {
    showPage('courses');
    return;
  }
  if (!row.current) {
    const r = await run(() => api(lessonUrl(row, '/current'), { method: 'POST' }));
    if (!r) return;
    toast(T.current(lessonName(row), r.differsFromRunning));
    await afterLessonChange(r);
  }
  showPage(nextPage());
}

function renderLessons() {
  const ul = $('#l-list');
  ul.textContent = '';
  $('#l-empty').hidden = (lessonRows ?? []).length > 0;
  for (const row of lessonRows ?? []) ul.append(lessonCard(row));
}

// 小卡：课名、"当前"标记、一行状态、一行数据、按钮（不再带做课步骤与备课进度，都在第 3 步）
function lessonCard(row) {
  const T = LESSON_TEXT;
  const title = row.broken ? T.brokenTitle : row.title || T.noTitle;
  const tags = [];
  if (row.kind === 'example') tags.push(el('span', { className: 'tag example', textContent: T.tagExample }));
  if (row.current) tags.push(el('span', { className: 'tag current', textContent: T.tagCurrent, title: T.tagCurrentTitle }));
  // 原始报错（row.error）不上页面，连 title 提示也不放（M3 禁露原始报错）
  const head = el('div', { className: 'l-head' }, el('h3', { className: 'l-title', textContent: title }), ...tags);
  const status = el('p', { className: 'l-status', textContent: `${lessonCardMeta(row)} · ${lessonCardStatus(row)}` });
  const data = row.broken ? '' : el('p', { className: 'l-data muted', textContent: lessonDataLine(row) });
  const ops = el('div', { className: 'l-ops' });
  for (const op of lessonCardOps(row)) {
    const b = el('button', { type: 'button', textContent: op.label, title: op.title, className: op.id === 'delete' ? 'danger' : op.id === 'continue' || op.id === 'current' ? 'primary' : '' });
    b.addEventListener('click', () => lessonAction(op.id, row, b));
    ops.append(b);
  }
  const li = el('li', { className: `card l-card${row.current ? ' is-current' : ''}` }, head, status, data, ops);
  li.dataset.dir = row.dir;
  return li;
}

async function lessonAction(id, row) {
  const name = lessonName(row);
  const T = LESSON_TEXT;
  if (id === 'continue') {
    showPage(nextPage());
  } else if (id === 'current') {
    const r = await run(() => api(lessonUrl(row, '/current'), { method: 'POST' }));
    if (!r) return;
    toast(T.current(name, r.differsFromRunning));
    await afterLessonChange(r);
  } else if (id === 'open') {
    await run(() => api(lessonUrl(row, '/open'), { method: 'POST' }), T.opened);
  } else if (id === 'rename') {
    const r = await renameDialog(row);
    if (!r) return;
    toast(T.renamed(r.title));
    await afterLessonChange(null); // 侧栏、全部课程页都换成新课名
  } else if (id === 'delete') {
    // G4：当前课也能删——确认框说清楚删后换到哪门（与服务端同一规则）或删后没有课程
    const next = row.current ? nextCurrentAfterDelete(lessonRows ?? [], row.dir) : null;
    const env = envCleansWith(overview?.env, row); // §3.3：唯一需要 Python 环境的课 → 确认框说会一起清理
    const ok = await confirmDialog(T.deleteConfirm(name, row.current ? { current: true, next: next ? lessonName(next) : null, env } : { env }), T.deleteOk);
    if (!ok) return;
    const r = await run(() => api(lessonUrl(row), { method: 'DELETE' }));
    if (!r) return;
    const to = r.current ? (lessonRows ?? []).find((x) => x.path === r.current.to) ?? null : null;
    toast(T.withCleaned(r.current ? T.deletedSwitched(name, to ? lessonName(to) : null) : T.deleted(name), r.cleaned));
    await afterLessonChange(r); // 侧栏去掉这门课；删的是当前课时各页换到新的当前课
  }
}

// G4 重命名对话框：预填原课名；回车或"改名"提交，课名不对时在框下说原因（服务端的一句话），不关对话框
function renameDialog(row) {
  const dlg = $('#rename-dlg');
  const form = $('#rename-form');
  const input = $('#rename-title');
  input.value = row.title ?? '';
  setText('#rename-err', '');
  return new Promise((resolve) => {
    let result = null;
    const onSubmit = async (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) {
        setText('#rename-err', LESSON_TEXT.needTitle);
        return;
      }
      if (title === row.title) {
        dlg.close();
        return;
      }
      $('#rename-ok').disabled = true;
      try {
        result = await api('/api/lessons/rename', { method: 'POST', body: { dir: row.dir, title } });
        dlg.close();
      } catch (err) {
        if (err.message !== '链接已失效') setText('#rename-err', err.message);
      } finally {
        $('#rename-ok').disabled = false;
      }
    };
    const onCancel = () => dlg.close();
    form.addEventListener('submit', onSubmit);
    $('#rename-cancel').addEventListener('click', onCancel);
    dlg.addEventListener('close', () => {
      form.removeEventListener('submit', onSubmit);
      $('#rename-cancel').removeEventListener('click', onCancel);
      resolve(result);
    }, { once: true });
    dlg.showModal();
    input.select();
  });
}
$('#rename-title').addEventListener('input', () => setText('#rename-err', ''));

// 课程换了（新建 / 设为当前 / 改名 / 删除）：课程列表重新读取，侧栏、全部课程页与"有改动未生效"跟着刷新
async function afterLessonChange(r) {
  autoChecked.clear();
  if (r && 'pendingRestart' in r) renderPlatform({ ...platform, pendingRestart: r.pendingRestart });
  await refresh();
  await loadLessons();
  if (currentPage === 'prepare') loadRoster();
  if (currentPage === 'data') {
    dataLesson = '';
    loadBackups();
  }
}

$('#l-title').addEventListener('input', () => setText('#l-new-err', ''));
$('#l-new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#l-title').value.trim();
  if (!title) {
    setText('#l-new-err', LESSON_TEXT.needTitle);
    $('#l-title').focus();
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const r = await api('/api/lessons', { method: 'POST', body: { title } });
    $('#l-title').value = '';
    toast(LESSON_TEXT.created(r.lesson.title));
    // 新建成功 → 成为当前课，进"教案"页签（G5 §2.4）
    await afterLessonChange(r);
    showPage('draft');
  } catch (err) {
    if (err.message !== '链接已失效') setText('#l-new-err', err.message);
  } finally {
    btn.disabled = false;
  }
});

// 页签"教案"：上传 / 重新上传、已上传提示；"没有教案，跳过 → 去做课"，上传后变成"接着去做课 →"
function renderDraft() {
  const cl = currentLesson();
  if (!cl) return;
  const T = LESSON_TEXT;
  setText('#d-upload-text', T.guideUpload(Boolean(cl.draft)));
  const note = draftNote(cl.draft);
  $('#d-note').hidden = !note;
  if (note) {
    $('#d-note').textContent = note.text;
    $('#d-note').className = `l-draft${note.bad ? ' bad' : ''}`;
  }
  const go = $('#d-go');
  go.textContent = cl.draft ? T.draftGoNext : T.draftGoSkip;
  go.className = cl.draft ? 'button primary' : 'button';
}
$('#d-upload').addEventListener('change', () => {
  const input = $('#d-upload');
  const file = input.files[0];
  input.value = '';
  if (file) uploadDraft(currentLesson(), file, $('#d-upload-label'));
});

async function uploadDraft(row, file, label) {
  if (!row) return;
  if (!isMine(row)) {
    toast(LESSON_TEXT.notMine, true);
    return;
  }
  const bad = uploadCheck(file);
  if (bad) {
    toast(bad, true);
    return;
  }
  const fd = new FormData();
  fd.append('file', file, file.name);
  label.classList.add('busy');
  try {
    const res = await fetch(lessonUrl(row, '/draft'), { method: 'POST', headers: { 'X-Manage-Token': TOKEN }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      showFatal('工作台链接已失效。请回到启动工作台时打开的那个窗口，按提示重新打开工作台链接。');
      return;
    }
    if (!res.ok) throw new Error(data.error || LESSON_TEXT.uploadFailed);
    const note = draftNote(data.draft);
    // 不自动跳：教师可能要再传；提示里说接着去做课，按钮变成"接着去做课 →"
    toast(LESSON_TEXT.draftUploaded(note.text), note.bad);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    label.classList.remove('busy');
  }
}

// ③ 用 AI 做课：引导句 + 三步（说明可收起 / 展开，记住在本机）+ 教案一行；下方"备课进度"折叠（只读）
//   force = 刚打开这一页；否则只有当前课的状态变了才重画（免得刷新时把"已复制 ✓"冲掉）
let buildSig = '';
function renderBuild(force) {
  const cl = currentLesson();
  if (!cl) return;
  const open = buildDescOpen(cl.status, store.get('manage:build-desc'));
  const sig = JSON.stringify([cl.dir, cl.status, cl.draft, cl.check, cl.stages, platformDir, open]);
  if (!force && sig === buildSig) return;
  buildSig = sig;
  const T = LESSON_TEXT;
  setText('#b-lead', lessonNextLead(cl));
  const toggle = $('#b-desc-toggle');
  toggle.textContent = open ? T.descClose : T.descOpen;
  toggle.setAttribute('aria-expanded', String(open));
  $('.b-card').classList.toggle('closed', !open);
  const controls = {};
  // 第 2 步：平台文件夹的位置 + 复制位置 + 打开文件夹
  const copyPath = el('button', { type: 'button', textContent: T.guideCopyPath, title: T.guideCopyPathTitle, disabled: !platformDir });
  copyPath.addEventListener('click', () => copyPlatformDir());
  const openPlatform = el('button', { type: 'button', textContent: T.guideOpenPlatform, title: T.guideOpenPlatformTitle });
  openPlatform.addEventListener('click', () => run(() => api('/api/platform/open', { method: 'POST' }), T.guideOpenedPlatform));
  controls.folder = [el('code', { className: `b-path${platformDir ? '' : ' missing'}`, title: T.guidePathTitle, textContent: platformDir ?? T.guidePathMissing }),
    el('div', { className: 'b-ops' }, copyPath, openPlatform)];
  // 第 3 步：复制开场话（主按钮；复制成功后按钮 1.5 s 显示"已复制"）
  const opening = el('button', { type: 'button', className: 'primary', textContent: T.guideOpening, title: T.guideOpeningTitle });
  opening.addEventListener('click', () => copyOpening(cl, opening));
  controls.opening = [el('div', { className: 'b-ops' }, opening)];
  const ol = $('#b-steps');
  ol.textContent = '';
  buildSteps().forEach((s, i) => {
    ol.append(el('li', { className: 'b-step' },
      el('span', { className: 'b-num', textContent: String(i + 1) }),
      el('div', { className: 'b-body' },
        el('p', { className: 'b-title', textContent: s.title, ...(open ? {} : { title: s.desc }) }),
        ...(open ? [el('p', { className: 'b-desc', textContent: s.desc })] : []),
        ...(controls[s.id] ?? []))));
  });
  // 教案一行：已上传 xxx（改 →）/ 没有上传（上传 →）
  setText('#b-draft-text', cl.draft ? T.draftLineSome(cl.draft.file) : T.draftLineNone);
  setText('#b-draft-link', cl.draft ? T.draftLineEdit : T.draftLineAdd);
  progressBlock(cl);
}
$('#b-desc-toggle').addEventListener('click', () => {
  const cl = currentLesson();
  const open = buildDescOpen(cl?.status, store.get('manage:build-desc'));
  store.set('manage:build-desc', open ? 'closed' : 'open');
  renderBuild(true);
});

// 复制平台文件夹的位置：剪贴板不能用时弹出已选中的文本框（与复制开场话同一个对话框，说明换成"位置"那句）
async function copyPlatformDir() {
  if (!platformDir) return;
  try {
    await navigator.clipboard.writeText(platformDir);
  } catch {
    manualCopy(platformDir, LESSON_TEXT.guideCopyPathManual, LESSON_TEXT.guideCopyPathManualTitle);
    return;
  }
  toast(LESSON_TEXT.guideCopiedPath);
}

// V1 只读备课表（代码题测试验证规格 §5）：折叠区（展开与否记在本机）；表下固定一句说明与"检查课程"
const progressBox = $('#b-progress');
progressBox.open = store.get('manage:progress-open') === 'open';
progressBox.addEventListener('toggle', () => store.set('manage:progress-open', progressBox.open ? 'open' : 'closed'));
function progressBlock(row) {
  const T = LESSON_TEXT;
  const rows = progressTableRows(row.status, row.check);
  const cell = (tag, c) => el(tag, { className: `tone-${c.tone}`, textContent: c.text, ...(c.title ? { title: c.title } : {}) });
  const table = rows.length === 0
    ? el('p', { className: 'l-progress-empty', textContent: T.progressEmpty })
    : el('div', { className: 'l-progress-scroll' }, el('table', { className: 'l-progress-table' },
      el('thead', {}, el('tr', {}, ...PROGRESS_COLUMNS.map((h) => el('th', { textContent: h })))),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.cells.map((c) => cell('td', c)))))));
  const btn = el('button', { type: 'button', textContent: T.progressCheck, title: T.progressCheckTitle });
  btn.addEventListener('click', () => checkCurrent(btn));
  $('#b-progress-body').replaceChildren(
    table,
    el('p', { className: 'l-progress-note', textContent: T.progressNote }),
    el('div', { className: 'l-progress-ops' }, btn));
}

// "检查课程"：查当前课，结果用同一个检查对话框显示，查完刷新（表里"测试"列跟着变）
async function checkCurrent(btn) {
  btn.disabled = true;
  btn.textContent = LESSON_TEXT.progressChecking;
  const r = await run(() => api('/api/lesson/check', { method: 'POST', body: {} }));
  btn.disabled = false;
  btn.textContent = LESSON_TEXT.progressCheck;
  if (!r) return;
  openCheckDialog(r);
  refreshSoon();
}

// 剪贴板不能用时：弹出已选中的文本框，教师自己复制（desc = 对话框里的说明句）
const COPY_DLG_TITLE = $('#copy-dlg-title').textContent;
const COPY_DLG_DESC = $('#copy-dlg-desc').textContent;
function manualCopy(text, desc, title = COPY_DLG_TITLE) {
  $('#copy-dlg-title').textContent = title;
  $('#copy-dlg-desc').textContent = desc;
  const ta = $('#copy-dlg-text');
  ta.value = text;
  $('#copy-dlg').showModal();
  ta.focus();
  ta.select();
}

// 复制开场话：剪贴板不能用时弹出已选中的文本框，教师自己复制
async function copyOpening(row, button) {
  if (!isMine(row)) {
    toast(LESSON_TEXT.notMine, true);
    return;
  }
  let text;
  try {
    const res = await fetch(lessonUrl(row, '/opening'), { headers: { 'X-Manage-Token': TOKEN } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || LESSON_TEXT.openingFailed);
    text = await res.text();
  } catch (err) {
    toast(err.message, true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    manualCopy(text, COPY_DLG_DESC);
    return;
  }
  toast(LESSON_TEXT.copied);
  if (!button.dataset.copied) {
    button.dataset.copied = '1';
    button.classList.add('copied');
    const original = button.textContent;
    button.textContent = LESSON_TEXT.copiedButton;
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
      delete button.dataset.copied;
    }, 1500);
  }
}

// ===== R4 平台更新（"平台"页"平台版本"一节 + 横幅区一行） =====
function renderUpdate() {
  const band = updateBandText(update);
  $('#p-update').hidden = !band || updatedAway;
  $('#p-update').textContent = band ?? '';
  const st = updateStatus(update, { platformState: platform.state, checking: updateChecking, armed: updateArmed });
  setText('#s-up-line', st.line);
  const check = $('#s-up-check');
  check.textContent = st.checkLabel;
  check.disabled = st.checkDisabled || updatedAway;
  check.hidden = Boolean(update?.dev);
  const apply = $('#s-up-apply');
  apply.hidden = !st.showApply || updatedAway;
  apply.textContent = st.applyLabel;
  apply.disabled = st.applyDisabled;
  $('#s-up-help').hidden = !(st.showApply && st.help);
  setText('#s-up-help', st.help);
  const log = $('#s-up-log');
  log.hidden = updateLines.length === 0;
  log.textContent = updateLines.join('\n');
  log.scrollTop = log.scrollHeight;
  // 更新进行中（或已更新、等工作台重启）：启动 / 重启 / 重建与出错框里的下一步按钮一律禁用
  if (update?.running || updatedAway) {
    for (const b of $$('[data-action="start"], [data-action="restart"], [data-action="rebuild"], #p-error-actions button')) {
      b.disabled = true;
    }
  }
  const rec = updateRecoveredText(update);
  $('#p-recovered').hidden = !rec;
  if (rec) {
    setText('#p-recovered-text', rec.text);
    $('#p-recovered').title = rec.title;
  }
  const res = updateResultText(update?.result);
  const box = $('#s-up-result');
  box.hidden = !res;
  if (res) {
    box.textContent = res.text;
    box.title = res.title;
    box.className = res.bad ? 'help warn' : 'help';
  }
  renderDiag($('#s-up-diag'), update?.running ? null : (update?.result ? update.result.diagnosis : update?.recovered?.diagnosis) ?? null);
  renderSideFoot();
}

$('#p-update').addEventListener('click', () => showPage('platform'));

$('#s-up-check').addEventListener('click', async () => {
  updateChecking = true;
  renderUpdate();
  const r = await run(() => api('/api/update/check', { method: 'POST' }));
  updateChecking = false;
  if (r) {
    if (r.error) toast(r.error, true);
    else update = { ...(update ?? {}), current: r.current, dev: r.dev, latest: r.latest, checkedAt: r.checkedAt };
  }
  renderUpdate();
});

// 两次点击：第一次变"再点一次确认"（5 秒内有效），第二次才开始
$('#s-up-apply').addEventListener('click', async () => {
  if (!update?.latest) return;
  if (!updateArmed) {
    updateArmed = true;
    clearTimeout(updateArmTimer);
    updateArmTimer = setTimeout(() => { updateArmed = false; renderUpdate(); }, 5000);
    renderUpdate();
    return;
  }
  updateArmed = false;
  clearTimeout(updateArmTimer);
  updateLines = [];
  update = { ...update, running: true, result: null };
  renderUpdate();
  const r = await run(() => api('/api/update/apply', { method: 'POST', body: { version: update.latest.version } }));
  if (!r) {
    update = { ...update, running: false };
    renderUpdate();
  }
});

// 更新成功：旧工作台 1 s 后退出（入口脚本会重新打开新工作台与新页面）；本页不再请求接口，
// 3 s 后每 3 s 试一下 GET /（不带凭据）：探到 200 → 新的工作台已打开，停止探测；最多探 2 分钟
function afterUpdated() {
  updatedAway = true;
  events?.close();
  const banner = $('#fatal');
  banner.className = 'banner good';
  banner.textContent = UPDATE_TEXT.done;
  banner.hidden = false;
  renderUpdate();
  const started = Date.now();
  setTimeout(() => {
    const timer = setInterval(async () => {
      if (Date.now() - started > 120_000) {
        clearInterval(timer);
        return;
      }
      try {
        const r = await fetch('/', { cache: 'no-store' });
        if (r.ok) {
          clearInterval(timer);
          banner.textContent = UPDATE_TEXT.reopened;
          setText('#s-up-result', UPDATE_TEXT.reopened);
        }
      } catch {
        // 还没起来
      }
    }, 3000);
  }, 3000);
}

// ===== 启动：先读一次总览（没有井号时要知道当前该做哪一步），再按井号显示页面 =====
if (!TOKEN) showFatal('缺少访问凭据。请回到启动工作台时打开的那个窗口，按提示打开工作台链接。');
$('#p-migrated-close').addEventListener('click', () => { $('#p-migrated').hidden = true; });
refresh().finally(() => {
  renderPage(location.hash);
  loadLessons();
});
run(() => api('/api/logs?lines=50')).then((r) => { if (r) logLines = r.lines; });
connectEvents();
