// sandbox 组件客户端注册（可选组件规格 §2.3；代码沙盒组件规格 §3.7；studentBanner 为契约 v0.7.1 槽位）
// 本文件经 import.meta.glob 打进每门课：模块顶层无副作用（槽位组件只在渲染 / effect 里调用内核与 pythonClient）
import TeacherToolbar from './client/slots/TeacherToolbar.jsx';
import TeacherSidebar from './client/slots/TeacherSidebar.jsx';
import StudentOverlay from './client/slots/StudentOverlay.jsx';
import StudentBanner from './client/slots/StudentBanner.jsx';
import TeacherPrelogin from './client/slots/TeacherPrelogin.jsx';

export default {
  slots: {
    teacherToolbar: TeacherToolbar,
    teacherSidebar: TeacherSidebar,
    studentOverlay: StudentOverlay,
    studentBanner: StudentBanner,
    // T9a：课前页一行"Python 就绪 N/M"（teacherToolbar 渲染 null，只登记信箱 key）
    teacherPrelogin: TeacherPrelogin,
  },
  store: {
    student: { initial: {}, on: {} },
    teacher: { initial: {}, on: {} },
  },
};
