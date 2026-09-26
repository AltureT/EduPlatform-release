import { io } from 'socket.io-client';

// 同源（'/'）：开发时 vite 代理 /socket.io → :3001；学生平板从 LAN IP 访问也能连上
export const socket = io('/', {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
  // 优先 websocket，避免 long-polling 把推送批量打包
  transports: ['websocket', 'polling'],
});
