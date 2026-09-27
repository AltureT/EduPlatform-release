// 外壳告诉 <Page> 它所在的阶段视图（界面整理规格 §3.5）：
// { view: 'student' | 'demo' | 'stats', config }，config 为该阶段 stage.config（与 useStudentStage(id).stage 同一对象）。
// 学生视图缺省模板取 config.layout（缺省 focus）；教师演示视图缺省 focus；统计视图由外壳套 table。
// P5：学生外壳另给 lessonId（lesson.id），<Page resizable> 用它生成拖宽比例的记忆键；没有时不记。
import { createContext } from 'react';

export const PageStageContext = createContext(null);

export const TEMPLATES = ['focus', 'split', 'tiles', 'table', 'stack'];

export function defaultTemplateOf(ctx) {
  if (!ctx) return 'focus';
  if (ctx.view === 'student') {
    const t = ctx.config && ctx.config.layout;
    return TEMPLATES.includes(t) ? t : 'focus';
  }
  if (ctx.view === 'stats') return 'table';
  return 'focus';
}

// U4（界面整理规格 §3.5）：focus 面板探测内容里有没有 <Fill>——Fill 挂载时调用它登记（返回注销函数）。
// 面板没有 Fill 时按内容高，有 Fill 时撑满；其它 Main 区与 Overlay 提供 null，挡住外层面板
export const FillProbeContext = createContext(null);
