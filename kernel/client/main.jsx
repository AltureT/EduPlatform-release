import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// K3：index.html 的兜底脚本判定浏览器太旧时已写入提示，这里不再挂载覆盖它
if (!window.__tooOld) createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
