// useResizeRedraw Hook：窗口尺寸变化时防抖触发重绘。
// rAF 合并同一帧内的多次 resize，500ms 后再补一次兜底（某些设备持续触发）；
// 用 ref 保存最新回调，避免监听器闭包读到过期状态（GroundTrack 甘特图 / Map2D fit 共用）。
import { useEffect, useRef } from "react";

export function useResizeRedraw(callback, deps = []) {
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  });

  useEffect(() => {
    let rafId;
    let timerId;
    const onResize = () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      rafId = requestAnimationFrame(() => cbRef.current());
      timerId = setTimeout(onResize, 500);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
