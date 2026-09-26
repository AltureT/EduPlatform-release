// 原语版程序题：只有配置 + 被引用的文件（自写版见 examples/python-intro/stages/03-tests）。
// 测试、起始代码、参考答案都用 { from } 从本目录读；solution 是保密选项，只发教师。
export default {
  id: 'leap-year',
  label: '闰年判断',
  primitive: 'code',
  options: {
    prompt: '写函数 is_leap(year)：year 是闰年返回 True，否则返回 False。\n\n写好先点"运行"看看输出，再点"测试"，让测试全部通过。',
    requirements: [
      '能被 4 整除的年份是闰年',
      '但能被 100 整除的不是闰年',
      '能被 400 整除的又是闰年',
    ],
    starter: { from: './starter.py' },
    tests: { 'test_main.py': { from: './tests/test_main.py' } },
    solution: { from: './solution.py' },
    gate: { testsPassed: 0.7, soft: true },
  },
};
