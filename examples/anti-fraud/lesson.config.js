// 反诈攻防对抗课（npm run new:lesson 生成）。阶段用 npm run new:stage 添加，改完跑 npm run check:lesson。
// 字段说明见契约（docs/02-阶段模块契约.md）§一；工作台左栏与课名标题行显示 title。
export default {
  id: 'anti-fraud',            // 持久化用，改名视为新课
  title: '反诈攻防对抗课',
  glyph: '反',                    // 登录页与头部的一字标识
  theme: {},                      // 覆盖主题 token，如 { brand: '#2B3A55' }
  roster: { mode: 'roster' },     // 'roster' | 'free'：课前页默认显示导入名单卡还是自由起名提示
  stagesDir: './stages',          // 相对本文件所在目录
  stages: ['01-perceive', '02-model', '03-classify', '04-tune', '05-intercept', '06-discover', '07-reflect'],                     // 阶段目录名，顺序即课堂顺序；npm run new:stage 会追加（prelogin 与 curtain 由内核加在首尾）
  curtain: { label: '总结', override: null },   // 谢幕；override：stagesDir 下的目录名（不列入 stages）
  // 可选组件：镜像 / 分享 / 个人报告；用 code / data-analysis 原语时 new:stage 会自动加上 'sandbox'
  components: ['mirror', 'share', 'report'],
};
