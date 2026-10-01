// 原语版程序题：只有配置 + 被引用的文件（自写版见 examples/python-intro/stages/03-tests）。
// 测试、起始代码、参考答案都用 { from } 从本目录读；solution 是保密选项，只发教师，大屏可显示、也可"公布"给学生。
// 要求清单第 2 条带 hint（学生点"提示 ▾"展开）；starter 给两份让学生选。
// V2（代码题批改）：hidden.json 的三条隐藏用例、mistakes/ 的两个错误版本由 npm run prep:tests 生成 tests/test_hidden.py 与 mistakes.json；
// brute.py 是笨办法解（对拍用）。mistakes 是保密选项，只发教师：统计页按学生测试失败的用例对上错误类型。
export default {
  id: 'leap-year',
  label: '闰年判断',
  primitive: 'code',
  options: {
    prompt: '写函数 is_leap(year)：year 是闰年返回 True，否则返回 False。\n\n写好先点"运行"看看输出，再点"测试"，让测试全部通过。',
    requirements: [
      '能被 4 整除的年份是闰年',
      { text: '但能被 100 整除的不是闰年', hint: 'year % 100 == 0 时先别急着返回 True，再看下一条' },
      '能被 400 整除的又是闰年',
    ],
    // 两份起点：学生进入时自己选（框架版有函数骨架，空白版从零写）；选过可"换起点"
    starter: [
      { label: '框架版', code: { from: './starter.py' } },
      { label: '空白版', code: '' },
    ],
    tests: { 'test_main.py': { from: './tests/test_main.py' }, 'test_hidden.py': { from: './tests/test_hidden.py' } },
    solution: { from: './solution.py' },
    mistakes: { from: './mistakes.json' },
    gate: { testsPassed: 0.7, soft: true },
  },
};
