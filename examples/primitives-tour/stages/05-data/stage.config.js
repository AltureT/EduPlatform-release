// 原语版数据分析：只有配置 + 数据文件（自写版见 examples/python-intro/stages/02-data）。
// 数据集用 { path, from }：from 读本目录的 data/scores.csv，写进学生虚拟文件系统的 path；学生页显示全部数据（可排序、筛选）。
// 任务可带 hint（代码片段），学生页"提示 ▾"展开。
export default {
  id: 'score-analysis',
  label: '成绩分析',
  primitive: 'data-analysis',
  gallery: true,                  // 课程组件"作品墙"开在这一段（components/gallery/README.md）
  options: {
    prompt: '这是一个班 12 位同学（编号 S01–S12）的语文、数学、英语成绩。\n\n先点"运行"看看起始代码读进来的表格，再完成下面的任务。',
    dataset: { path: 'data/scores.csv', from: './data/scores.csv' },
    tasks: [
      '算出各科的平均分',
      {
        text: '画各科平均分的柱状图（标题、坐标轴用中文）',
        hint: "import matplotlib.pyplot as plt\n\navg = df[['语文', '数学', '英语']].mean()\navg.plot(kind='bar', title='各科平均分')\nplt.xlabel('科目')\nplt.ylabel('平均分')\nplt.show()",
      },
      '找出数学最高分是哪位同学',
    ],
  },
};
