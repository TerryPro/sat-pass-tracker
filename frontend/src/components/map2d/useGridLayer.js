// 2D 地图：经纬网/经纬度标注图层 hook（见 grid.js：pickStep / drawGridOnMap）。
// 开关控制可见性；缩放/平移/投影/主题变化时按新状态重绘。
import { useEffect } from "react";
import { drawGridOnMap } from "../grid.js";

export function useGridLayer({ mapObjRef, gridSourceRef, proj, showGrid, theme }) {
  const drawGrid = (curProj) =>
    drawGridOnMap({ map: mapObjRef.current, source: gridSourceRef.current, proj: curProj });

  // 开关/投影/主题变化：控制可见性；打开时重绘
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const gridLayer = map.getLayers().getArray().find((l) => l.get("name") === "grid");
    if (!gridLayer) return;
    gridLayer.setVisible(showGrid);
    if (showGrid) setTimeout(() => drawGrid(proj), 0);
  }, [showGrid, proj, theme, mapObjRef, gridSourceRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // 缩放/平移变化时，如果经纬网开着，按新 zoom 步长重绘
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const handler = () => {
      if (showGrid) drawGrid(proj);
    };
    const view = map.getView();
    view.on("change:resolution", handler);
    view.on("change:center", handler);
    return () => {
      view.un("change:resolution", handler);
      view.un("change:center", handler);
    };
  }, [proj, showGrid, mapObjRef, gridSourceRef]); // eslint-disable-line react-hooks/exhaustive-deps
}
