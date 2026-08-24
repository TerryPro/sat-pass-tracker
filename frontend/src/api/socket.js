// Socket.IO 连接模块：创建实时连接并注册数据事件回调。
// 连接状态（connect / disconnect / connect_error）由上层 hook 或组件管理。
import { io } from "socket.io-client";

// 建立 Socket.IO 连接
// 事件：
//   state              → { station, position }
//   satellite:position → { t, az, el, r_km }
export function createSocket(onState, onPosition) {
  const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
  socket.on("connect", () => {
    // 连接成功后由服务端回发 state
  });
  socket.on("state", (data) => onState && onState(data));
  socket.on("satellite:position", (pos) => onPosition && onPosition(pos));
  return socket;
}
