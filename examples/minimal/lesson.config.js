export default {
  id: 'minimal',                 // 持久化用，改名视为新课
  title: '示例课',
  glyph: '课',                    // 登录页与头部的一字标识
  theme: {},                      // 覆盖 token，如 { brand: '#2B3A55' }
  roster: { mode: 'roster' },     // 'roster' | 'free'：只决定课前页默认显示导入卡还是自由起名提示；运行时 rosterMode 一律由 roster.size > 0 推导
  stagesDir: './stages',          // 相对本配置文件所在目录
  stages: ['01-vote', '02-freeform'],   // 目录名，顺序即课堂顺序；prelogin 与 curtain 由内核自动加在首尾
  curtain: { label: '总结', override: null },   // override: stagesDir 下的目录名（不列入 stages，只含 Student.jsx / TeacherStats.jsx，无 stage.config.js）
  // 可选组件（组件规格 §4）：镜像 / 分享 / 随堂一句话 / 个人报告；缺省在全部阶段显示入口
  components: [
    'mirror',
    'share',
    { id: 'inbox', questions: [{ id: 'q1', title: '今天最有收获的一点', fields: [{ key: 'text', label: '写一句话', max: 100 }] }] },
    'report',
  ],
};
