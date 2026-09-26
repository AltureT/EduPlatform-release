// 管理台页面（管理台规格 §5）：原生 JS（ES module），无依赖；fetch + EventSource
// 纯函数（向导步骤、失败后的下一步、备份 / 课程文案、Python 运行时状态）在 /ui-logic.js（scripts/manage/ui-logic.js，有单测）
// M3：首页未运行时是向导（每步的输入就在向导里完成），运行中是上课面板；技术信息只放"更多信息"折叠与 title 提示
import {
  guideSteps, wizardView, stepCounter, passwordError, pyodideStatus, fetchProgress,
  errorActions, backupSummary, fmtDate, fmtSize, lessonChoices, lessonOptionLabel, lessonOptionTitle, lessonSummary,
  splitAddresses, stateLabel, pickLesson, classroomLesson, wizardBackSteps,
  checkSummary, checkNotice, checkItems, checkReportText,
  lessonCardStatus, lessonCardMeta, draftNote, lessonCardOps, uploadCheck, DRAFT_EXTS, LESSON_TEXT, lessonName,
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

const BUSY = new Set(['building', 'starting', 'stopping']);
let overview = null;
let platform = { state: 'stopped' };
let currentTab = 'home';
let logLines = [];
let fetchLines = [];
let fetchFailed = false;

// ===== 通用 =====
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Manage-Token': TOKEN, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    showFatal('管理台链接已失效。请回到启动管理台时打开的那个窗口，按提示重新打开管理台链接。');
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

// ===== 标签页：地址栏井号即当前标签（#settings 等可直接打开；切换标签会留下历史记录，后退可回到上一个标签） =====
const TABS = ['home', 'lessons', 'settings', 'roster', 'data'];
let pendingFocus = null;
function showTab(name, { field } = {}) {
  if (!TABS.includes(name)) name = 'home';
  pendingFocus = field || null;
  if (location.hash === `#${name}`) renderTab(name);
  else location.hash = name; // 触发 hashchange → renderTab
}
window.addEventListener('hashchange', () => renderTab(location.hash.slice(1)));
function renderTab(name) {
  if (!TABS.includes(name)) name = 'home';
  currentTab = name;
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const s of $$('.tab')) s.hidden = s.id !== `tab-${name}`;
  if (name === 'lessons') loadLessons();
  if (name === 'settings') loadSettings();
  if (name === 'roster') loadRoster();
  if (name === 'data') loadBackups();
  refresh(); // 状态带在所有标签页都显示
}
for (const b of $$('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
$('#p-gohome').addEventListener('click', () => showTab('home'));

// ===== 首页向导（未运行时） =====
let wizardRequested = null; // 教师在左列点的已完成步骤
const editing = { password: false, lesson: false }; // 已完成步骤里点了"改密码" / "换一门"
let lessonList = null;
let backOpen = false; // 窄屏"改前面的步骤"展开

function selectStep(id) {
  wizardRequested = id;
  backOpen = false;
  editing.password = false;
  editing.lesson = false;
  renderWizard();
}

function renderWizard() {
  if (!overview) return;
  const running = platform.state === 'running';
  $('#wizard').hidden = running;
  $('#classroom').hidden = !running;
  if (running) {
    renderClassroom();
    return;
  }
  const g = guideSteps({ ...overview, platform });
  const view = wizardView(g, wizardRequested);
  // 左列：数字圆点 + 标题；已完成打 ✓ 变灰，当前步深色圆点 + 粗字，未到的浅灰且不可点
  const ol = $('#wz-steps');
  ol.textContent = '';
  for (const s of g.steps) {
    const cls = s.done ? 'done' : s.current ? 'current' : 'todo';
    const btn = el('button', {
      type: 'button', className: `wz-step ${cls}${s.id === view ? ' viewing' : ''}`, disabled: !s.clickable,
      title: s.done ? `回到这一步修改：${s.title}` : s.current ? '当前这一步' : '先完成上面的步骤',
    },
    el('span', { className: 'wz-dot', textContent: s.done ? '✓' : String(s.n) }),
    el('span', { className: 'wz-step-text' },
      el('span', { className: 'wz-step-title', textContent: s.title }),
      ...(s.done && s.summary ? [el('span', { className: 'wz-step-sum', textContent: s.summary })] : [])));
    if (s.id === view) btn.setAttribute('aria-current', 'step');
    btn.addEventListener('click', () => selectStep(s.id));
    ol.append(el('li', { className: cls }, btn));
  }
  setText('#wz-compact', stepCounter(g, view));
  // 窄屏：折叠行旁边"改前面的步骤"，点开列出已完成的步骤（宽屏由样式隐藏）
  const back = wizardBackSteps(g, view);
  $('#wz-back').hidden = back.length === 0;
  $('#wz-back').setAttribute('aria-expanded', String(backOpen));
  const backList = $('#wz-back-list');
  backList.hidden = !backOpen || back.length === 0;
  backList.textContent = '';
  for (const s of back) {
    const b = el('button', { type: 'button', textContent: `✓ ${s.title}`, title: `回到这一步修改：${s.title}` });
    b.addEventListener('click', () => selectStep(s.id));
    backList.append(b);
  }
  const step = g.steps.find((s) => s.id === view);
  // L1：课程选好后显示当前课的检查结果（第 2 步与"启动平台"一步）；本页还没查过就在后台查一次（只读，不影响启动）
  const lessonDone = g.steps.find((s) => s.id === 'lesson')?.done;
  if (lessonDone && !overview.check) autoCheck(overview.lesson?.path);
  const notice = lessonDone ? checkNotice(overview.check) : null;
  for (const id of ['wz-lesson-check', 'wz-start-check']) {
    $(`#${id}`).hidden = !notice;
    if (notice) {
      setText(`#${id}-text`, notice.text);
      $(`#${id}`).dataset.tone = notice.tone;
    }
  }
  for (const pane of $$('.wz-pane')) pane.hidden = pane.dataset.pane !== step.inline;
  if (step.inline === 'password') renderPasswordPane(step);
  if (step.inline === 'lesson') renderLessonPane(step);
  if (step.inline === 'pyodide') renderPyodide();
  if (step.inline === 'start') renderStartPane(step);
}

$('#wz-back').addEventListener('click', () => {
  backOpen = !backOpen;
  renderWizard();
});

function renderPasswordPane(step) {
  const showForm = !step.done || editing.password;
  $('#wz-pw-summary').hidden = showForm;
  $('#wz-pw-form').hidden = !showForm;
}
$('#wz-pw-change').addEventListener('click', () => {
  editing.password = true;
  renderWizard();
  $('#wz-pw').focus();
});
$('#wz-pw-show').addEventListener('change', (e) => { $('#wz-pw').type = e.target.checked ? 'text' : 'password'; });
$('#wz-pw').addEventListener('input', () => setText('#wz-pw-err', ''));
$('#wz-pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#wz-pw').value;
  const bad = passwordError(pw);
  if (bad) {
    setText('#wz-pw-err', bad);
    $('#wz-pw').focus();
    return;
  }
  try {
    await api('/api/settings', { method: 'PUT', body: { TEACHER_PASSWORD: pw } });
  } catch (err) {
    setText('#wz-pw-err', err.data?.errors?.TEACHER_PASSWORD || err.data?.errors?._ || err.message);
    return;
  }
  $('#wz-pw').value = '';
  editing.password = false;
  wizardRequested = null;
  toast('教师密码已保存');
  await refresh();
});

async function ensureLessonList() {
  const cur = overview?.lesson?.path;
  const list = lessonList ?? (lessonList = await run(() => api('/api/lessons')));
  const sel = $('#wz-lesson');
  if (!list || sel.dataset.for === cur) return;
  sel.textContent = '';
  const choices = lessonChoices(list, cur, overview?.lesson);
  for (const l of choices) {
    sel.append(el('option', { value: l.path, textContent: lessonOptionLabel(l), title: lessonOptionTitle(l) }));
  }
  // 当前课找不到或读不出来：默认选第一门能用的课，免得"继续"把坏路径再存回去
  sel.value = pickLesson(choices, cur);
  sel.dataset.for = cur;
}

function renderLessonPane(step) {
  const showForm = !step.done || editing.lesson;
  $('#wz-lesson-summary').hidden = showForm;
  $('#wz-lesson-form').hidden = !showForm;
  setText('#wz-lesson-current', step.summary);
  if (showForm) $('#wz-lesson-check').hidden = true;
  if (showForm) {
    ensureLessonList();
    // 原始报错只放 title 提示
    const errEl = $('#wz-lesson-err');
    if (overview.lesson?.error) {
      errEl.textContent = lessonSummary(overview.lesson).meta;
      errEl.title = overview.lesson.error;
    } else {
      errEl.title = '';
    }
  }
}
$('#wz-lesson-change').addEventListener('click', () => {
  editing.lesson = true;
  lessonList = null; // 换课时重新扫描（AI 可能刚生成了新课程）
  $('#wz-lesson').dataset.for = '';
  renderWizard();
  $('#wz-lesson').focus();
});
$('#wz-lesson').addEventListener('change', () => setText('#wz-lesson-err', ''));
$('#wz-lesson-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = $('#wz-lesson').value;
  if (!value) {
    setText('#wz-lesson-err', '请选择课程');
    return;
  }
  try {
    await api('/api/settings', { method: 'PUT', body: { LESSON_CONFIG: value } });
  } catch (err) {
    setText('#wz-lesson-err', err.data?.errors?.LESSON_CONFIG || err.data?.errors?._ || err.message);
    return;
  }
  editing.lesson = false;
  wizardRequested = null;
  $('#wz-lesson').dataset.for = '';
  toast('课程已选好');
  await refresh();
});

// 第 3 步与设置页共用：状态、进度条、失败详情
function renderPyodide() {
  if (!overview) return;
  const py = overview.pyodide;
  const ps = pyodideStatus(py);
  const prog = fetchProgress(fetchLines);
  const showProg = py.fetching || (fetchLines.length > 0 && !fetchFailed && !py.ready);
  for (const prefix of ['wz', 's']) {
    const bar = $(`#${prefix}-py-progress`);
    bar.hidden = !showProg;
    bar.setAttribute('aria-valuenow', String(prog.percent));
    bar.firstElementChild.style.width = `${prog.percent}%`;
    setText(`#${prefix}-py-label`, py.fetching ? prog.label : '');
    $(`#${prefix}-py-fail`).hidden = !fetchFailed || py.fetching;
    const det = $(`#${prefix}-py-detail`);
    det.hidden = !fetchFailed || py.fetching;
    det.querySelector('pre').textContent = fetchLines.slice(-30).join('\n');
  }
  // 向导第 3 步
  $('#wz-py-ready').hidden = !py.ready || py.fetching;
  const wzBtn = $('#wz-py-btn');
  wzBtn.textContent = py.fetching ? '正在下载…' : py.ready ? '检查并补全' : fetchFailed ? '再试一次' : '开始下载';
  wzBtn.className = py.ready && !py.fetching ? '' : 'primary';
  wzBtn.title = ps.buttonTitle;
  // 设置页：状态文字，版本与文件数只放 title
  setText('#s-py-state', ps.label);
  $('#s-py-state').title = ps.title;
  $('#s-py-dot').className = `dot ${ps.dot}`;
  const sBtn = $('#s-py-btn');
  sBtn.textContent = py.fetching ? '正在下载…' : ps.button;
  sBtn.title = ps.buttonTitle;
  for (const b of $$('[data-action="fetch-pyodide"]')) b.disabled = Boolean(py.fetching);
}

function renderStartPane(step) {
  const busy = step.busy;
  $('#wz-start').hidden = busy;
  $('#wz-start').disabled = platform.state !== 'stopped';
  $('#wz-busy').hidden = !busy;
  setText('#wz-busy-text', busy ? stateLabel(platform) : '');
}

// ===== 首页上课面板（运行中） =====
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
  const ps = pyodideStatus(o.pyodide);
  setText('#m-py', ps.label + (ps.title ? `（${ps.title}）` : ''));
  setText('#m-db', fmtSize(o.data.dbSize));
  setText('#m-backup', o.data.lastBackup ? fmtDate(o.data.lastBackup.mtime) : '还没有备份');
  setText('#m-dir', cl.dir);
  // L1：正在上的课启动前的检查结果；有提醒时给"查看"
  const pc = platform.check;
  setText('#m-check', checkSummary(pc).text);
  $('#m-check-open').hidden = !checkNotice(pc);
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
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-check-open]');
  if (!b || b.disabled) return;
  openCheckDialog(b.dataset.checkOpen === 'running' ? platform.check : overview?.check);
});

// 向导第 2 步：当前课还没查过时后台查一次（每门课每次打开页面最多一次）
const autoChecked = new Set();
function autoCheck(path) {
  if (!path || autoChecked.has(path) || overview?.lesson?.error || platform.state !== 'stopped') return;
  autoChecked.add(path);
  api('/api/lesson/check', { method: 'POST', body: {} }).then(() => refreshSoon(), () => {});
}

// 设置页"检查课程"：查下拉框里选中的课（不用启动平台）
let settingsCheck = null;
$('#s-check-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const path = $('#settings-form').LESSON_CONFIG.value;
  btn.disabled = true;
  setText('#s-check-summary', '正在检查…');
  $('#s-check-summary').dataset.tone = 'off';
  try {
    const r = await api('/api/lesson/check', { method: 'POST', body: path ? { path } : {} });
    settingsCheck = r;
    const s = checkSummary(r);
    setText('#s-check-summary', s.text);
    $('#s-check-summary').dataset.tone = s.tone;
    renderCheckList($('#s-check-list'), r);
    $('#s-check-result').hidden = checkItems(r).length === 0;
    refreshSoon();
  } catch (err) {
    setText('#s-check-summary', err.message === '链接已失效' ? '' : `没能检查：${err.message}`);
    $('#s-check-summary').dataset.tone = 'bad';
    $('#s-check-result').hidden = true;
  } finally {
    btn.disabled = false;
  }
});
$('#s-check-copy').addEventListener('click', (e) => copyCheck(settingsCheck, e.currentTarget));
$('#c-log').addEventListener('click', () => openDrawer());

// 出错框里的按钮统一走这里
async function doAction(a, button) {
  switch (a.id) {
    case 'goto-settings': showTab('settings', { field: a.field }); break;
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

// ===== 状态带 =====
function renderPlatform(p) {
  platform = p;
  const s = p.state;
  const err = p.error;
  $('#dot').className = `dot ${s === 'running' ? 'good' : s === 'stopped' ? (err ? 'bad' : 'off') : 'busy'}`;
  setText('#p-state', stateLabel(p));
  $('#p-spin').hidden = !BUSY.has(s);
  // 未启动：首页只说"完成下方步骤后启动"，其它标签给一个回首页的按钮
  const idle = s === 'stopped' && !err;
  setText('#p-meta', idle && currentTab === 'home' ? '· 完成下方步骤后启动' : '');
  $('#p-gohome').hidden = !(s === 'stopped' && currentTab !== 'home');
  // 按钮：运行中"停止 / 重启"，过渡中只"停止"；启动在首页向导里
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
  // 运行中在状态带里直接给学生地址（可点，新标签打开）
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
  $('#pending').hidden = !p.pendingRestart;
  renderResetDesc();
  renderWizard();
}

function renderOverview(o) {
  const wasRunning = overview?.platform?.state === 'running';
  overview = o;
  if (o.pyodide.result && !o.pyodide.fetching && !o.pyodide.result.ok && fetchLines.length === 0) {
    fetchFailed = true;
    fetchLines = o.pyodide.result.tail || [];
  }
  if (o.pyodide.ready && !o.pyodide.fetching) fetchFailed = false;
  if (wasRunning && o.platform.state !== 'running') wizardRequested = null;
  renderPyodide();
  renderPlatform({ ...o.platform, pendingRestart: o.pendingRestart });
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
// 运行中每 10 秒刷新首页：已进入人数、"课程文件有更新"黄条
setInterval(() => {
  if (platform.state === 'running' && currentTab === 'home' && !document.hidden) refresh();
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
  es.addEventListener('platform', (e) => {
    const p = JSON.parse(e.data);
    const changed = p.state !== platform.state;
    renderPlatform(p);
    if (changed) refreshSoon();
  });
  es.addEventListener('log', (e) => pushLog(JSON.parse(e.data).line));
  // 准备页面的输出只进运行记录，页面上只显示状态文字与转圈
  es.addEventListener('build', (e) => pushLog(JSON.parse(e.data).line));
  es.addEventListener('fetch', (e) => {
    const d = JSON.parse(e.data);
    if (d.line !== undefined) {
      fetchLines.push(d.line);
      if (fetchLines.length > 200) fetchLines.shift();
      renderPyodide();
    }
    if (d.done) {
      fetchFailed = !d.ok;
      if (d.ok) toast('Python 运行时已就绪');
      else toast('下载没有完成，可以再点一次继续', true);
      refreshSoon();
    }
  });
  es.onerror = () => {
    setText('#p-state', '与管理台的连接中断，正在重连…');
    setText('#p-meta', '若一直如此，说明启动管理台时打开的那个窗口已关闭');
    $('#dot').className = 'dot busy';
  };
  es.onopen = () => refreshSoon();
}

// ===== 按钮动作 =====
const ACTIONS = {
  start: () => run(() => api('/api/platform/start', { method: 'POST' })),
  stop: () => run(() => api('/api/platform/stop', { method: 'POST' })),
  restart: () => run(() => api('/api/platform/restart', { method: 'POST' })),
  rebuild: () => run(() => api('/api/platform/rebuild', { method: 'POST' }), '开始重新构建页面，完成后再启动平台'),
  'fetch-pyodide': async () => {
    fetchLines = [];
    fetchFailed = false;
    if (overview) overview.pyodide.fetching = true;
    renderPyodide();
    const r = await run(() => api('/api/pyodide/fetch', { method: 'POST' }));
    if (!r && overview) overview.pyodide.fetching = false;
    refreshSoon();
  },
  backup: async () => {
    await run(() => api('/api/backups', { method: 'POST' }), (r) => `已备份：${r.file}`);
    refreshSoon();
    loadBackups();
  },
  'roster-clear': async () => {
    if (!(await confirmDialog('清空名单后，学生加入时要自己填写名字。', '清空名单'))) return;
    await run(() => api('/api/roster/clear', { method: 'POST' }), '名单已清空');
    loadRoster();
  },
  'reset-bindings': async () => {
    if (!(await confirmDialog('所有平板和名字的对应关系会被解除，学生需要重新选择自己的名字。', '解除所有平板绑定'))) return;
    await run(() => api('/api/roster/reset-bindings', { method: 'POST' }), '设备绑定已重置');
    loadRoster();
  },
  reset: async () => {
    const running = platform.state === 'running';
    const text = running
      ? '将清除学生记录、平板绑定和各环节里学生做的内容，课堂回到第一个环节；名单保留。所有学生平板会回到登录页。\n重置前会自动备份一份。'
      : '平台没有运行：将删除全部课堂数据，名单也会一起清除，下次需要重新导入。\n重置前会自动备份一份。';
    if (!(await confirmDialog(text, '重置并回到第一环节'))) return;
    await run(() => api('/api/reset', { method: 'POST', body: { confirm: true } }),
      (r) => `已重置${r.online ? '（名单保留）' : ''}，重置前的数据已存为 ${r.snapshot || '（原本没有数据）'}`);
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
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-copy]');
  if (!b || b.disabled || b.dataset.copied || !b.dataset.copy) return;
  copyText(b.dataset.copy, b);
});

// ===== 设置 =====
let settings = null;
async function loadSettings() {
  const [s, lessons] = await Promise.all([run(() => api('/api/settings')), run(() => api('/api/lessons'))]);
  if (!s || !lessons) return;
  settings = s;
  const f = $('#settings-form');
  f.TEACHER_PASSWORD.value = s.values.TEACHER_PASSWORD;
  f.PORT.value = s.values.PORT;
  f.AI_BASE_URL.value = s.values.AI_BASE_URL;
  f.AI_MODEL.value = s.values.AI_MODEL;
  f.AI_API_KEY.value = '';
  setText('#key-current', s.values.AI_API_KEY ? `当前密钥：${s.values.AI_API_KEY}` : '当前没有密钥');
  const sel = f.LESSON_CONFIG;
  sel.textContent = '';
  const cur = s.values.LESSON_CONFIG;
  // 每项只显示标题，目录放 title 提示（M3）
  for (const l of lessonChoices(lessons, cur, overview?.lesson)) {
    sel.append(el('option', { value: l.path, textContent: lessonOptionLabel(l), title: lessonOptionTitle(l) }));
  }
  sel.value = cur;
  updatePortHint();
  clearErrors();
  setText('#settings-msg', '');
  if (pendingFocus && f[pendingFocus]) {
    f[pendingFocus].focus();
    f[pendingFocus].scrollIntoView({ block: 'center' });
    pendingFocus = null;
  }
}
function clearErrors() {
  for (const e of $$('[data-err]')) e.textContent = '';
}
function updatePortHint() {
  const p = Number($('#settings-form').PORT.value);
  $('#port-hint').hidden = !(settings?.lowPortNeedsAdmin && p > 0 && p < 1024);
}
$('#settings-form').PORT.addEventListener('input', updatePortHint);
$('#show-pw').addEventListener('change', (e) => {
  $('#settings-form').TEACHER_PASSWORD.type = e.target.checked ? 'text' : 'password';
});

async function saveSettings(patch) {
  clearErrors();
  const msg = $('#settings-msg');
  const okText = () => (platform.state === 'stopped' ? '已保存，下次启动平台时生效。' : '已保存，重启平台后生效。');
  try {
    const r = await api('/api/settings', { method: 'PUT', body: patch });
    renderPlatform({ ...platform, pendingRestart: r.pendingRestart });
    lessonList = null; // 首页向导的课程下拉重新读取
    $('#wz-lesson').dataset.for = '';
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
  const f = e.target;
  const patch = {
    TEACHER_PASSWORD: f.TEACHER_PASSWORD.value,
    PORT: f.PORT.value,
    LESSON_CONFIG: f.LESSON_CONFIG.value,
    AI_BASE_URL: f.AI_BASE_URL.value.trim(),
    AI_MODEL: f.AI_MODEL.value.trim(),
  };
  if (f.AI_API_KEY.value !== '') patch.AI_API_KEY = f.AI_API_KEY.value.trim();
  saveSettings(patch);
});
$('#clear-key').addEventListener('click', async () => {
  if (!(await confirmDialog('清空后，用到 AI 的功能将无法使用，需要重新填写密钥。', '清空密钥'))) return;
  saveSettings({ AI_API_KEY: '' });
});

// ===== 名单 =====
let previewNames = null;
async function loadRoster() {
  try {
    const r = await api('/api/roster');
    setText('#r-status', r.count ? `名单共 ${r.count} 人，已绑定平板 ${r.bound} 台` : '还没有导入名单（学生加入时自己填名字）');
    setText('#r-names', r.names.slice(0, 20).join('、') + (r.count > 20 ? ` … 等 ${r.count} 人` : ''));
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
  setText('#r-preview-count', r.count ? `解析出 ${r.count} 个名字` : '没有解析出名字，请检查是否每行一个名字');
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
  const r = await run(() => api('/api/roster', { method: 'POST', body: { names: previewNames } }), (x) => `已导入 ${x.count} 个名字`);
  if (r) {
    $('#r-preview-box').hidden = true;
    $('#r-text').value = '';
    loadRoster();
    refreshSoon();
  }
});

// ===== 数据 =====
function renderResetDesc() {
  setText('#reset-desc', platform.state === 'running'
    ? '现在平台运行中：清除学生记录、平板绑定和各环节里学生做的内容，课堂回到第一个环节；名单保留。'
    : '现在平台没有运行：删除全部课堂数据，名单也会一起清除，下次需要重新导入。');
}
async function loadBackups() {
  const list = await run(() => api('/api/backups'));
  if (!list) return;
  const ul = $('#b-list');
  ul.textContent = '';
  $('#b-empty').hidden = list.length > 0;
  for (const b of list) {
    const dl = el('button', { type: 'button', className: 'small', textContent: '下载', title: '把这份备份存到别处' });
    dl.addEventListener('click', () => download(b.file));
    const rs = el('button', { type: 'button', className: 'small danger', textContent: '恢复这份', title: '用这份备份覆盖当前课堂数据（需先停止平台）' });
    rs.addEventListener('click', () => restoreBackup(b.file));
    ul.append(el('li', {},
      el('div', { className: 'backup-text' },
        el('span', { textContent: backupSummary(b) }),
        el('span', { className: 'file-name', textContent: b.file })),
      el('div', { className: 'backup-ops' }, dl, rs)));
  }
}
async function download(file) {
  try {
    const res = await fetch(`/api/backups/${encodeURIComponent(file)}`, { headers: { 'X-Manage-Token': TOKEN } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '下载失败');
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
async function restoreBackup(file) {
  if (platform.state !== 'stopped') {
    toast('请先停止平台，再恢复备份', true);
    return;
  }
  const ok = await confirmDialog(
    `用 ${file} 覆盖当前的课堂数据。\n恢复前会自动把当前数据备份一份。恢复后学生下次进入会回到登录页。`,
    '覆盖并恢复这份备份',
  );
  if (!ok) return;
  await run(() => api(`/api/backups/${encodeURIComponent(file)}/restore`, { method: 'POST' }),
    (r) => `已恢复。恢复前的数据已存为 ${r.snapshot || '（原本没有数据）'}。学生下次进入会回到登录页`);
  loadBackups();
  refreshSoon();
}

// ===== 课程（M4，发布包与课程管理规格 §4） =====
// 课程目录 lessons/<名> → 接口 /api/lessons/lessons/<名>/…（两段都编码，目录名不含分隔符）
const lessonUrl = (row, tail = '') => `/api/lessons/${row.dir.split('/').map(encodeURIComponent).join('/')}${tail}`;
let lessonRows = [];

async function loadLessons() {
  const [rows, tpl] = await Promise.all([run(() => api('/api/lessons/overview')), run(() => api('/api/lessons/templates'))]);
  if (tpl) {
    $('#l-tpl-docx').hidden = !tpl.docx;
    $('#l-tpl-md').hidden = !tpl.md;
    $('#l-tpl').hidden = !tpl.docx && !tpl.md;
  }
  if (!rows) return;
  lessonRows = rows;
  renderLessons();
}

function renderLessons() {
  const ul = $('#l-list');
  ul.textContent = '';
  $('#l-empty').hidden = lessonRows.length > 0;
  for (const row of lessonRows) ul.append(lessonCard(row));
}

function lessonCard(row) {
  const T = LESSON_TEXT;
  const title = row.broken ? T.brokenTitle : row.title || T.noTitle;
  const tags = [el('span', { className: `tag ${row.kind === 'mine' ? 'mine' : 'example'}`, textContent: row.kind === 'mine' ? T.tagMine : T.tagExample })];
  if (row.current) tags.push(el('span', { className: 'tag current', textContent: T.tagCurrent, title: T.tagCurrentTitle }));
  // 原始报错（row.error）不上页面，连 title 提示也不放（M3 禁露原始报错）
  const head = el('div', { className: 'l-head' }, el('h3', { className: 'l-title', textContent: title }), ...tags);
  const status = el('p', { className: 'l-status', textContent: `${lessonCardMeta(row)} · ${lessonCardStatus(row)}` });
  const note = draftNote(row.draft);
  const draft = el('p', { className: `l-draft${note?.bad ? ' bad' : ''}`, textContent: note?.text ?? '', hidden: !note });
  const ops = el('div', { className: 'l-ops' });
  for (const op of lessonCardOps(row)) {
    if (op.id === 'upload') {
      const input = el('input', { type: 'file', accept: DRAFT_EXTS.join(',') });
      input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (file) uploadDraft(row, file, label);
      });
      const label = el('label', { className: 'file', title: op.title }, op.label, input);
      ops.append(label);
      continue;
    }
    const b = el('button', { type: 'button', textContent: op.label, title: op.title, className: op.id === 'delete' ? 'danger' : op.id === 'current' && row.kind === 'mine' ? 'primary' : '' });
    b.addEventListener('click', () => lessonAction(op.id, row, b));
    ops.append(b);
  }
  return el('li', { className: `card l-card${row.current ? ' is-current' : ''}` }, head, status, draft, ops);
}

async function lessonAction(id, row, button) {
  const name = lessonName(row);
  const T = LESSON_TEXT;
  if (id === 'current') {
    const r = await run(() => api(lessonUrl(row, '/current'), { method: 'POST' }));
    if (!r) return;
    toast(T.current(name, r.differsFromRunning));
    afterLessonChange(r);
  } else if (id === 'opening') {
    await copyOpening(row, button);
  } else if (id === 'open') {
    await run(() => api(lessonUrl(row, '/open'), { method: 'POST' }), T.opened);
  } else if (id === 'delete') {
    const ok = await confirmDialog(T.deleteConfirm(name), T.deleteOk);
    if (!ok) return;
    const r = await run(() => api(lessonUrl(row), { method: 'DELETE' }), T.deleted(name));
    if (r) loadLessons();
  }
}

// 课程换了（新建 / 设为当前）：首页向导的课程下拉重新读取，状态带与"有改动未生效"跟着刷新
function afterLessonChange(r) {
  lessonList = null;
  $('#wz-lesson').dataset.for = '';
  if (r && 'pendingRestart' in r) renderPlatform({ ...platform, pendingRestart: r.pendingRestart });
  loadLessons();
  refreshSoon();
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
    afterLessonChange(r);
  } catch (err) {
    if (err.message !== '链接已失效') setText('#l-new-err', err.message);
  } finally {
    btn.disabled = false;
  }
});

async function uploadDraft(row, file, label) {
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
      showFatal('管理台链接已失效。请回到启动管理台时打开的那个窗口，按提示重新打开管理台链接。');
      return;
    }
    if (!res.ok) throw new Error(data.error || LESSON_TEXT.uploadFailed);
    const note = draftNote(data.draft);
    toast(note.text, note.bad);
    loadLessons();
  } catch (err) {
    toast(err.message, true);
  } finally {
    label.classList.remove('busy');
  }
}

// 复制开场话：剪贴板不能用时弹出已选中的文本框，教师自己复制
async function copyOpening(row, button) {
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
    const ta = $('#copy-dlg-text');
    ta.value = text;
    $('#copy-dlg').showModal();
    ta.focus();
    ta.select();
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

// 模板下载（带访问凭据，所以用 fetch 取回再存）
for (const b of $$('[data-tpl]')) {
  b.addEventListener('click', async () => {
    const kind = b.dataset.tpl;
    try {
      const res = await fetch(`/api/lessons/template.${kind}`, { headers: { 'X-Manage-Token': TOKEN } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || LESSON_TEXT.downloadFailed);
      const url = URL.createObjectURL(await res.blob());
      const a = el('a', { href: url, download: `教学设计模板.${kind}` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ===== 启动 =====
if (!TOKEN) showFatal('缺少访问凭据。请回到启动管理台时打开的那个窗口，按提示打开管理台链接。');
renderTab(location.hash.slice(1) || 'home');
run(() => api('/api/logs?lines=50')).then((r) => { if (r) logLines = r.lines; });
connectEvents();
