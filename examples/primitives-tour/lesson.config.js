// 原语巡礼：每个阶段用一种活动原语，stage.config.js 只写配置（活动原语规格 §4）。
// 作为 skill 的"抄作业"范本与原语的回归测试对象；五段各用一种原语：vote / quiz / free-text / code / data-analysis。
// code / data-analysis 建在 sandbox 组件上：打开 sandbox，学生加入后空闲时预载 pandas / matplotlib。
// gallery（作品墙）是本课自己的课程组件（components/gallery/，课程组件的范本），开在 05-data（顶层 gallery: true）。
export default {
  id: 'primitives-tour',
  title: '原语巡礼',
  glyph: '原',
  theme: {},
  roster: { mode: 'free' },
  stagesDir: './stages',
  stages: ['01-vote', '02-quiz', '03-free-text', '04-code', '05-data'],
  curtain: { label: '总结', override: null },
  components: ['mirror', 'share', { id: 'sandbox', packages: ['pandas', 'matplotlib'] }, 'gallery', 'report'],
};
