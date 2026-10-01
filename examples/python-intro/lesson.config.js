export default {
  id: 'python-intro',            // 持久化用，改名视为新课
  title: 'Python 入门',
  glyph: '码',                    // 登录页与头部的一字标识
  theme: {},
  roster: { mode: 'roster' },
  stagesDir: './stages',          // 相对本配置文件所在目录
  stages: ['01-hello', '02-data', '03-tests', '04-site'],
  curtain: { label: '总结', override: null },
  // 代码沙盒（代码沙盒组件规格 §4）：学生 join 后空闲时预载核心 + pandas / matplotlib；Flask 轮子一并预载
  // AI 助手（coach 组件规格 §7）：02-data、03-tests 写了 coach: true；工作台第 4 步"上课准备"没填 AI 接口时学生端不出现入口
  components: [
    'mirror',
    'share',
    { id: 'sandbox', packages: ['pandas', 'matplotlib'], flask: true },
    'report',
    'coach',
  ],
};
