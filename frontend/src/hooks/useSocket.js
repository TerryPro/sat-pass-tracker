// useSocket Hook：管理 Socket.IO 生命周期与数据分发。
// 挂载时建立连接并同步连接状态到 Redux（connected/disconnected），
// 实时位置写入 track.currentPos；卸载时清理事件并断开连接。
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { setCurrentPos, setSocketStatus } from "../slices/trackSlice.js";
import { createSocket } from "../api/socket.js";

export function useSocket() {
  const dispatch = useDispatch();

  useEffect(() => {
    const socket = createSocket(
      // 服务端回发的站点配置：携带当前实时位置
      (state) => {
        if (state && state.position) dispatch(setCurrentPos(state.position));
      },
      // 卫星实时方位/仰角/距离
      (pos) => dispatch(setCurrentPos(pos))
    );

    const onConnect = () => dispatch(setSocketStatus("connected"));
    const onLost = () => dispatch(setSocketStatus("disconnected"));
    socket.on("connect", onConnect);
    socket.on("disconnect", onLost);
    socket.on("connect_error", onLost);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onLost);
      socket.off("connect_error", onLost);
      socket.disconnect();
    };
  }, [dispatch]);
}
