// 经纬网（Graticule）生命周期 hook：在 Viewer 就绪且视图激活时实例化一次，
// 由 showGrid 开关控制显示/隐藏；Viewer 销毁时同步销毁经纬网。
// 复用 Graticules.js（移植自 cesium-graticule），供 Globe3D(3D) 与 CesiumMap2D(Cesium 2D) 共用。
import { useEffect, useRef } from "react";
import Graticules from "./Graticules.js";

export function useGraticule({ viewerRef, state, active, showGrid, options }) {
  const graticuleRef = useRef(null);

  // 创建：Viewer 就绪且视图激活时懒实例化一次（实例内部已 show，随后按 showGrid 校正）。
  // 关键：延迟到下一帧再实例化——Graticules 构造时立即按当前相机首次绘制，若此刻 viewer
  // 刚创建/相机尚未稳定，首帧网格会按错误的视口范围画出（表现为首次开启显示异常，切视图才正常）。
  useEffect(() => {
    if (!active || state !== "ready") return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (graticuleRef.current) return; // 已创建
    const timer = setTimeout(() => {
      let g;
      try {
        g = new Graticules(viewer, options);
      } catch (_) {
        return; /* viewer 已销毁，忽略 */
      }
      graticuleRef.current = g;
      if (showGrid) {
        // 主动触发一次相机更新回调，以当前稳定相机会话重绘，纠正可能的首帧偏差
        try {
          viewer.scene.camera.changed.raiseEvent();
        } catch (_) {
          /* 触发失败忽略 */
        }
      } else {
        g.hide();
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      if (graticuleRef.current) {
        try {
          graticuleRef.current.destroy();
        } catch (_) {
          /* Viewer 已销毁，忽略 */
        }
        graticuleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRef, state, active]);

  // 开关：showGrid 变化时切换显示/隐藏
  useEffect(() => {
    const g = graticuleRef.current;
    if (g && !g.isDestroyed) g.visible = !!showGrid;
  }, [showGrid]);

  return graticuleRef;
}