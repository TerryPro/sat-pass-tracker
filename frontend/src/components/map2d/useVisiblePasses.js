// 2D 地图：过境可见段高亮图层 hook（AOS~LOS，selected/all 两种模式）。
import { useEffect, useRef } from "react";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat } from "ol/proj";
import { mapIsDark } from "../mapStyles.js";
import { segmentAndBuildFeatures } from "../trackgeo.js";

export function useVisiblePasses({
  mapObjRef, visibleSourceRef,
  gt, passes, activePass, passMode, visibleHours, proj, theme,
}) {
  const toMapRef = useRef(null);
  toMapRef.current = (pLon, pLat) =>
    proj === "EPSG:4326" ? [pLon, pLat] : fromLonLat([pLon, pLat]);

  // 过境联动：高亮可见段（AOS~LOS），selected 模式仅当前过境，all 模式显示当前显示窗口内的全部
  useEffect(() => {
    const src = visibleSourceRef.current;
    if (!src || !gt || !passes) return;
    src.clear();

    // 配色随主题：暗色底图亮黄/白字黑晕，亮色底图深琥珀/黑字白晕
    const dark = mapIsDark();
    const passColor = dark ? "#facc15" : "#b45309";
    const haloColor = dark ? "#ffffff" : "#1f2937";
    const labelFill = dark ? "#ffffff" : "#111827";
    const labelHalo = dark ? "#000000" : "#ffffff";

    const startT = gt.points.length ? new Date(gt.points[0].t).getTime() : 0;
    const cutoff = startT + visibleHours * 3600 * 1000;

    let passesToDraw;
    if (passMode === "selected") {
      passesToDraw = activePass ? [activePass] : [];
    } else {
      // 仅保留与当前显示时长窗口有重叠的过境
      passesToDraw = passes.filter((pass) => {
        const tAos = new Date(pass.aos).getTime();
        const tLos = new Date(pass.los).getTime();
        return tLos >= startT && tAos <= cutoff;
      });
    }
    if (passesToDraw.length === 0) return;

    const mkPt = (p, label, color) => {
      const f = new Feature(new Point(toMapRef.current(p.lon, p.lat)));
      f.setStyle(
        new Style({
          image: new Circle({
            radius: 3,
            fill: new Fill({ color }),
            stroke: new Stroke({ color: haloColor, width: 1 }),
          }),
          text: new Text({
            text: label,
            offsetY: -12,
            fill: new Fill({ color: labelFill }),
            stroke: new Stroke({ color: labelHalo, width: 3 }),
            font: "bold 11px sans-serif",
          }),
        })
      );
      src.addFeature(f);
    };

    passesToDraw.forEach((pass) => {
      const t0 = new Date(pass.aos).getTime();
      const t1 = new Date(pass.los).getTime();
      const vis = gt.points.filter((p) => {
        const t = new Date(p.t).getTime();
        return t >= t0 && t <= t1;
      });
      if (vis.length < 2) return;

      const fs = segmentAndBuildFeatures(vis, toMapRef.current, 0, proj === "EPSG:4326");
      fs.forEach((f) => {
        f.setStyle(new Style({ stroke: new Stroke({ color: passColor, width: 2.5 }) }));
        src.addFeature(f);
      });

      mkPt(vis[0], "AOS", "#ef4444");
      mkPt(vis[vis.length - 1], "LOS", "#22c55e");
    });
  }, [activePass, gt, proj, passMode, passes, visibleHours, theme, visibleSourceRef, mapObjRef]);
}
