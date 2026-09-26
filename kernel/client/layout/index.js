// 布局原语与页面模板（界面整理规格 §3）。阶段与组件经公开入口 #kernel/client/index.js 引用，不直接引用本文件。
export { default as Page } from './Page.jsx';
export { default as Fill } from './Fill.jsx';
export { default as Split } from './Split.jsx';
export { default as Tiles } from './Tiles.jsx';
export { default as Tile } from './Tile.jsx';
export { default as Stack } from './Stack.jsx';
export { default as Row } from './Row.jsx';
export { default as Scroll } from './Scroll.jsx';
export { useNarrow } from './useNarrow.js';
