// report：谢幕时为每个学生（含离线）按各阶段 summarize 约定生成个人报告
// 条目 { label, value, cohort?, format? }（契约 §二）：U6 起 format 可为 'text'（缺省）| 'code'（客户端按代码块 <CodeView> 显示）；
// 其它 format 值去掉（按文字显示），其余键原样
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
      cctx.data.set(name, { builtAt, sections });
    }
    cctx.data.setClass({ builtAt, count: students.length });
    cctx.actions.append('report-build', { count: students.length });
  });
}
