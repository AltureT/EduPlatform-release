// 把 lesson.theme 写入 CSS 变量，lesson.title 写入文档标题
import { useEffect } from 'react';
import { applyTheme } from '../theme.js';

export function useLessonChrome(lesson) {
  const theme = lesson && lesson.theme;
  const title = lesson && lesson.title;
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (title && typeof document !== 'undefined') document.title = title;
  }, [title]);
}
