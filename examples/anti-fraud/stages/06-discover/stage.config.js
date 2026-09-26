// 发现新特点：用原语 free-text，options 见 primitives/free-text/README.md。
export default {
  id: 'discover',
  label: '发现新特点',
  primitive: 'free-text',
  options: {
    prompts: [
      {
        id: 'feature',
        title: '第 4 段哪类短信最难抓？为什么？写一句你发现的新诈骗特点',
        placeholder: '哪类最难抓，你发现了什么特点',
        min: 5,
        max: 200,
      },
    ],
    canChange: true,
    gate: { submitted: 0.7, soft: true },
    idleAlertMs: 0,
  },
};
