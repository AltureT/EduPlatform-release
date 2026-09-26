// 默认谢幕视图：<Page template="tiles" title>，Main 放 <CurtainSlot /> 与组件 teacherCurtain / studentCurtain 槽位（按顺序成磁贴）。
// overrideDir（stagesDir 下的目录名）存在且找到对应组件时，学生端用其 Student.jsx、教师端用其 TeacherStats.jsx，
// 组件谢幕槽位仍在其后渲染（不受 override 影响）。
import { getCurtainOverride } from '../stores/stageStores.js';
import Page from '../layout/Page.jsx';
import CurtainSlot from './CurtainSlot.jsx';
import { ComponentSlot } from './ComponentSlots.jsx';

export default function Curtain({ role = 'student', title, overrideDir = null }) {
  const slot = <ComponentSlot role={role} slot={role === 'teacher' ? 'teacherCurtain' : 'studentCurtain'} />;
  const ov = getCurtainOverride(overrideDir);
  const Override = ov ? (role === 'teacher' ? ov.TeacherStats : ov.Student) : null;
  if (Override) {
    return (
      <>
        <Override />
        {slot}
      </>
    );
  }
  return (
    <Page template="tiles" title={title || undefined} data-testid="curtain">
      <Page.Main>
        <CurtainSlot role={role} />
        {slot}
      </Page.Main>
    </Page>
  );
}
