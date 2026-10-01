// teacherPrelogin 槽位（T9a，教师视图与学生页重排规格 §2.1）：教师课前页一行"Python 就绪 N/M"
// （学生浏览器里的 Python 运行时加载好了几个 / 在线几人；课前按 core 计）。原来是顶栏芯片，现在状态不当按钮摆
import { useComponent } from '#kernel/client/index.js';
import { usePythonReady } from './pythonReady.js';

const HELP = '学生浏览器里的 Python 加载好了几个 / 在线几人；代码题要等就绪才能运行';

function Line() {
  const r = usePythonReady();
  return <span data-sandbox-prelogin="" title={HELP}>{`Python 就绪 ${r.ready}/${r.online}`}</span>;
}

export default function TeacherPrelogin() {
  const c = useComponent('sandbox');
  if (c.role !== 'teacher') return null;
  return <Line />;
}
