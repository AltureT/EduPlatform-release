// 段 3 · 过测试：写 grade(score)，让五个测试用例全部通过（正常三档 + 90、60 两个分界值），另有两条隐藏用例（满分、零分）
export const TASK = '写 grade(score)：90 分及以上返回"优秀"，60 分及以上返回"及格"，否则返回"不及格"，让测试全部通过';

const STARTER = [
  'def grade(score):',
  '    ...',
  '',
  '',
  "if __name__ == '__main__':",
  '    print(grade(95))',
  '',
].join('\n');

// 测试文件会打进客户端 bundle，学生能看到内容（限制说明见 STAGE.md）
const TEST_GRADE = [
  'from main import grade',
  '',
  '',
  'def test_excellent():',
  "    assert grade(95) == '优秀'",
  '',
  '',
  'def test_pass():',
  "    assert grade(75) == '及格'",
  '',
  '',
  'def test_fail():',
  "    assert grade(30) == '不及格'",
  '',
  '',
  'def test_boundary_90():',
  "    assert grade(90) == '优秀'",
  "    assert grade(89) == '及格'",
  '',
  '',
  'def test_boundary_60():',
  "    assert grade(60) == '及格'",
  "    assert grade(59) == '不及格'",
  '',
].join('\n');

// 隐藏用例（代码题批改规格 §3）：tests/test_hidden.py 的全文，由 npm run prep:tests 从 hidden.json 生成、只存期望值的哈希；
// 自写段的 sandbox.tests 只收文本，所以原样抄成字符串（check:lesson 会比对，过期会提醒重跑）
const TEST_HIDDEN = [
  '# 由 npm run prep:tests 生成，不要手改；期望值只存哈希',
  'import hashlib',
  '',
  '',
  'def _h(v):',
  '    return hashlib.sha256(repr(v).encode()).hexdigest()[:16]',
  '',
  '',
  'def _call(expr):',
  '    import main',
  '    return eval(expr, vars(main))',
  '',
  '',
  'def test_hidden_1():',
  '    """隐藏用例：满分"""',
  '    assert _h(_call("grade(100)")) == \'f289732bfe855c2c\'',
  '',
  '',
  'def test_hidden_2():',
  '    """隐藏用例：零分"""',
  '    assert _h(_call("grade(0)")) == \'bf2de843e5d68fb5\'',
  '',
].join('\n');

const IDLE_MS = 8 * 60_000;

export const allPassed = (t) => !!t && t.total > 0 && t.passed === t.total;

function median(values) {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export default {
  id: 'tests',
  label: '过测试',
  primitive: null,
  reviewInteractive: false,
  layout: 'split',             // 页面样式（契约 v0.7）：focus | split | tiles | table | stack
  coach: true,                 // AI 助手：学生卡住时可以问 AI 要提示（只给提示，不给答案）

  sandbox: {
    tests: { 'test_grade.py': TEST_GRADE, 'test_hidden.py': TEST_HIDDEN },
    starter: STARTER,
  },

  // E：在线学生提交率 ≥ 70%（只有全部通过才能提交），软提示
  gate(ctx) {
    const connected = ctx.state.connected();
    const submitted = connected.filter((s) => ctx.data.get(s.name)?.submittedAt != null).length;
    if (submitted < Math.ceil(connected.length * 0.7)) {
      return { ok: false, soft: true, reason: `已提交 ${submitted}/${connected.length}，未到 70%` };
    }
    return { ok: true };
  },

  collect: {
    perStudent: { code: 'text', stdout: 'text', error: 'text', tests: 'object', runs: 'integer', ms: 'integer', submittedAt: 'integer' },
  },

  // 组件钩子
  // recommend：全部通过的提交按 submittedAt 升序前 5
  recommend({ perStudent }) {
    return Object.entries(perStudent ?? {})
      .filter(([, r]) => allPassed(r?.tests) && typeof r.submittedAt === 'number')
      .sort((a, b) => a[1].submittedAt - b[1].submittedAt)
      .slice(0, 5)
      .map(([name], i) => ({ name, reason: `第 ${i + 1} 个全部通过` }));
  },

  // score：通过用例数
  score(record) {
    return Number.isInteger(record?.tests?.passed) ? record.tests.passed : 0;
  },

  // summarize：通过用例数 + 全班中位数
  summarize(record, { perStudent } = {}) {
    const passed = Object.values(perStudent ?? {})
      .map((r) => r?.tests?.passed)
      .filter((n) => Number.isInteger(n));
    const t = record?.tests;
    return [{ label: '通过用例', value: t ? `${t.passed} / ${t.total}` : '未提交', cohort: { median: median(passed) } }];
  },

  alerts: [
    // 记录里的 tests 只来自提交（服务端只收全对），所以"未全部通过"即还没有全对的提交
    { id: 'idle', when: (s, now) => !allPassed(s.tests) && s.enteredStageAt != null && now - s.enteredStageAt > IDLE_MS, text: '8 分钟未全部通过' },
  ],
};
