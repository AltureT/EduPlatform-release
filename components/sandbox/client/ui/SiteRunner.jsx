// <SiteRunner stageId home onResponse …PyRunner 的 prop>（上课细节收口规格 §6）：网站段版式
// - <Fill> 撑满父级 → <Split ratio="1:1" stackBy="container" resizable storageKey="sandbox:site">
//   左块 <PyRunner stacked>（代码在上、输出在下；home / onResponse 以外的 prop 原样转发）
//   右块 <Fill>：一行小标题（与 PyRunner 的小标题同样式）+ <WebSim stageId home onResponse> 撑满
// - 容器窄于 900 时上下排（PyRunner 在上），两块按 1:1 分高、各自内部滚动
import { Fill, Split } from '#kernel/client/index.js';
import PyRunner, { Caption } from './PyRunner.jsx';
import WebSim from './WebSim.jsx';

const SIM_CAPTION = '模拟浏览器 · 网站只在这里能打开，别的标签页打不开';

export default function SiteRunner({ stageId, home, onResponse, ...runnerProps }) {
  return (
    <Fill data-sandbox-site="">
      <Split ratio="1:1" stack="ratio" stackBy="container" resizable storageKey="sandbox:site">
        <PyRunner stageId={stageId} {...runnerProps} stacked />
        <Fill>
          <Caption>{SIM_CAPTION}</Caption>
          <WebSim stageId={stageId} home={home} onResponse={onResponse} />
        </Fill>
      </Split>
    </Fill>
  );
}
