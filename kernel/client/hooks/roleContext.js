// 本端角色（v0.5）：TeacherApp 提供 'teacher'、StudentApp 提供 'student'；renderWithKernel 按 role 提供。
// useComponent().role、镜像内"当前阶段取本端 core store"都据此判断；外壳之外缺省为 'student'。
import { createContext, useContext } from 'react';

export const KernelRoleContext = createContext('student');

export function useKernelRole() {
  return useContext(KernelRoleContext) === 'teacher' ? 'teacher' : 'student';
}
