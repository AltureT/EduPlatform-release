// 段 4 · 小网站：改最小 Flask 应用，在模拟浏览器里访问
export const TASK = '改一改这个留言板网站，在模拟浏览器里访问、提交表单看效果';

// 最小 Flask 应用：首页 + 表单 POST 后 redirect 回首页。不调用 app.run()：模拟浏览器直接把请求交给 app
const STARTER = [
  'from flask import Flask, request, redirect',
  'from markupsafe import escape',
  '',
  'app = Flask(__name__)',
  'notes = []',
  '',
  '',
  "@app.route('/')",
  'def home():',
  "    items = ''.join(f'<li>{escape(n)}</li>' for n in notes)",
  "    return f'''<h1>留言板</h1>",
  '<form method="post" action="/add">',
  '  <input name="text">',
  '  <button>留言</button>',
  '</form>',
  "<ul>{items}</ul>'''",
  '',
  '',
  "@app.route('/add', methods=['POST'])",
  'def add():',
  "    text = request.form.get('text', '').strip()",
  '    if text:',
  '        notes.append(text)',
  "    return redirect('/')",
  '',
].join('\n');

const IDLE_MS = 8 * 60_000;
export const homeOk = (status) => Number.isInteger(status) && status >= 200 && status < 400;

export default {
  id: 'site',
  label: '小网站',
  primitive: null,
  reviewInteractive: false,
  layout: 'split',             // 页面样式（契约 v0.7）：focus | split | tiles | table | stack

  sandbox: {
    flask: true,
    starter: STARTER,
  },

  // E：在线学生提交率 ≥ 70%，软提示
  gate(ctx) {
    const connected = ctx.state.connected();
    const submitted = connected.filter((s) => ctx.data.get(s.name)?.submittedAt != null).length;
    if (submitted < Math.ceil(connected.length * 0.7)) {
      return { ok: false, soft: true, reason: `已提交 ${submitted}/${connected.length}，未到 70%` };
    }
    return { ok: true };
  },

  collect: {
    perStudent: { code: 'text', stdout: 'text', error: 'text', runs: 'integer', ms: 'integer', homeStatus: 'integer', submittedAt: 'integer' },
  },

  // 组件钩子：个人报告条目——首页状态码
  summarize(record) {
    return [{ label: '首页状态码', value: Number.isInteger(record?.homeStatus) ? record.homeStatus : '无' }];
  },

  alerts: [
    { id: 'idle', when: (s, now) => s.submittedAt == null && s.enteredStageAt != null && now - s.enteredStageAt > IDLE_MS, text: '8 分钟未提交' },
    // homeStatus 为 null = 提交时模拟浏览器还没在新代码下打开过首页（未检查），不算打不开
    { id: 'home-error', when: (s) => s.submittedAt != null && s.homeStatus != null && !homeOk(s.homeStatus), text: '首页打不开' },
  ],
};
