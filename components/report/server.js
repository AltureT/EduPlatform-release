// report：谢幕时为每个学生（含离线）按各阶段 summarize 约定生成个人报告
// 条目 { label, value, cohort?, format? }（契约 §二）：U6 起 format 可为 'text'（缺省）| 'code'（客户端按代码块 <CodeView> 显示）；
// 其它 format 值去掉（按文字显示），其余键原样
// C5（课程本地组件规格 §4）：各阶段 section 之后，按 lesson.config.components 顺序对每个导出 report 的组件
//   （cctx.componentReports()）调用一次 report(name) → [{ label, value, format? }]，section 标题 = 组件 label、
//   stageId = 'component:<id>'；≤ 12 条、label ≤ 20 字、value ≤ 2000 字（超出截断）；抛错只记日志、该节省略；没有条目也省略
import { shape } from '#kernel/server/schema.js';

const FORMATS = new Set(['text', 'code']);
const normItem = (it) => (it && typeof it === 'object' && 'format' in it && !FORMATS.has(it.format)
  ? Object.fromEntries(Object.entries(it).filter(([k]) => k !== 'format'))
  : it);

function defaultSummarize(record, config) {
  const fields = Object.keys(config?.collect?.perStudent ?? {});
  return fields.map((key) => ({ label: key, value: record[key] }));
}

async function buildSection(stage, record, stageData) {
  const { config } = stage;
  let items;
  try {
    items = typeof config?.summarize === 'function'
      ? await config.summarize(record, { perStudent: stageData.all(), perClass: stageData.getClass() })
      : defaultSummarize(record, config);
    items = Array.isArray(items) ? items.map(normItem) : [];
  } catch (err) {
    items = [{ label: '生成失败', value: err?.message ?? String(err) }];
  }
  return { stageId: stage.id, label: stage.label ?? config?.label ?? stage.id, items };
}

export const COMPONENT_REPORT_LIMITS = Object.freeze({ items: 12, label: 20, value: 2000 });
const cut = (str, n) => {
  const chars = Array.from(str);
  return chars.length > n ? chars.slice(0, n).join('') : str;
};

// 组件条目 → 与阶段条目同形；label 不是非空字符串的条目丢掉
export function normComponentItems(items) {
  if (!Array.isArray(items)) return [];
  const L = COMPONENT_REPORT_LIMITS;
  const out = [];
  for (const it of items) {
    if (out.length >= L.items) break;
    if (!it || typeof it !== 'object' || typeof it.label !== 'string' || it.label.trim() === '') continue;
    let { value } = it;
    if (value === undefined || value === null) value = null;
    else if (typeof value === 'number') value = Number.isFinite(value) ? value : null;
    else value = cut(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value), L.value);
    const item = { label: cut(it.label, L.label), value };
    if (FORMATS.has(it.format)) item.format = it.format;
    out.push(item);
  }
  return out;
}

async function componentSections(cctx, name) {
  const out = [];
  for (const p of cctx.componentReports?.() ?? []) {
    try {
      const items = normComponentItems(await p.report(name));
      if (items.length) out.push({ stageId: `component:${p.id}`, componentId: p.id, label: p.label ?? p.id, items });
    } catch (err) {
      cctx.log.warn(`component "${p.id}" report failed: ${err?.message ?? err}`);
    }
  }
  return out;
}

export function register(cctx) {
  cctx.on('report:t-build', shape({}), async (socket) => {
    if (cctx.state.currentStage !== 'curtain') return cctx.reject(socket, '仅谢幕时可生成报告');
    const stages = cctx.stages.list();
    const students = cctx.state.students();
    const builtAt = Date.now();
    for (const { name } of students) {
      const sections = [];
      for (const stage of stages) {
        const stageData = cctx.stages.data(stage.id);
        const record = stageData.get(name);
        if (record == null) continue;
        sections.push(await buildSection(stage, record, stageData));
      }
      sections.push(...await componentSections(cctx, name));
      cctx.data.set(name, { builtAt, sections });
    }
    cctx.data.setClass({ builtAt, count: students.length });
    cctx.actions.append('report-build', { count: students.length });
  });
}
