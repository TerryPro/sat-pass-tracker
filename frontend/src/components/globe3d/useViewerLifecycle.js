// 懒创建/销毁 Cesium Viewer 的 hook：创建 + ResizeObserver + 点击拾取 + 隐藏切回刷新尺寸。
import { useEffect, useRef } from "react";
import { Cesium } from "./cesiumGlobal.js";
import { createViewer, resetCamera } from "./viewer.js";

export function useViewerLifecycle({ active, state, containerRef, viewerRef, onPickNorad }) {
  const createdRef = useRef(false);
  const resizeObserverRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const onPickNoradRef = useRef(onPickNorad);
  onPickNoradRef.current = onPickNorad;

  // 懒创建 Viewer
  useEffect(() => {
    if (!active || state !== "ready" || createdRef.current || !containerRef.current) return;
    const viewer = createViewer(containerRef.current, { showClockControls: true });
    viewerRef.current = viewer;
    createdRef.current = true;
    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;
    resetCamera(viewer, 0, 20000000);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      if (picked && picked.primitive && picked.primitive.id !== undefined) {
        onPickNoradRef.current && onPickNoradRef.current(picked.primitive.id);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    clickHandlerRef.current = handler;

    return () => {
      if (clickHandlerRef.current) { clickHandlerRef.current.destroy(); clickHandlerRef.current = null; }
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      viewer.destroy();
      viewerRef.current = null;
      createdRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state]);

  // 隐藏切回时刷新尺寸
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !active) return;
    const timers = [0, 60, 120, 300].map((ms) => setTimeout(() => viewer.resize(), ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
