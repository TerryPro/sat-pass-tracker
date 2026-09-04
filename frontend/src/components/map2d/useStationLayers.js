// 2D 地图：地面站标记 + 可视范围图层 hook。
import { useEffect, useRef } from "react";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat } from "ol/proj";
import { mapIsDark } from "../mapStyles.js";
import { computeFootprint, satAltKm } from "../trackgeo.js";

export function useStationLayers({
  mapObjRef, stationSourceRef, stationFootprintSourceRef,
  lat, lon, alt, proj, theme, showVisibility,
  currentPos, satellite, activePass, gt,
}) {
  const stationFootFRef = useRef(null); // 地面站可视范围 feature
  const toMapRef = useRef(null);
  toMapRef.current = (pLon, pLat) =>
    proj === "EPSG:4326" ? [pLon, pLat] : fromLonLat([pLon, pLat]);

  // 地面站标记（文字/晕圈随主题：暗色白字黑晕、亮色黑字白晕）
  useEffect(() => {
    const src = stationSourceRef.current;
    if (!src) return;
    src.clear();
    const dark = mapIsDark();
    const f = new Feature(new Point(toMapRef.current(lon, lat)));
    f.setStyle(
      new Style({
        image: new Circle({
          radius: 7,
          fill: new Fill({ color: "#ef4444" }),
          stroke: new Stroke({ color: dark ? "#fff" : "#7f1d1d", width: 2 }),
        }),
        text: new Text({
          text: "地面站",
          offsetY: 16,
          fill: new Fill({ color: dark ? "#ffffff" : "#111827" }),
          stroke: new Stroke({ color: dark ? "#000000" : "#ffffff", width: 3 }),
        }),
      })
    );
    src.addFeature(f);
  }, [lat, lon, proj, theme, stationSourceRef, mapObjRef]);

  // 地面站可视范围（0° 仰角可通视范围）：以地面站为中心的大圆
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const layer = map.getLayers().getArray().find((l) => l.get("name") === "stationFootprint");
    if (layer) layer.setVisible(showVisibility);
  }, [showVisibility, mapObjRef]);

  // 优先用当前选中过境的最大仰角点反算卫星高度，其次用实时位置，最后按卫星类型默认值
  function resolveSatHeight() {
    // 1) 当前选中过境的最大仰角点：过境期间离地面站最近，高度最具代表性
    if (activePass && gt && gt.points && gt.points.length) {
      const tPeak = new Date(activePass.max_elevation_at).getTime();
      let best = null;
      let bestD = Infinity;
      for (const p of gt.points) {
        const dt = Math.abs(new Date(p.t).getTime() - tPeak);
        if (dt < bestD) {
          bestD = dt;
          best = p;
        }
      }
      if (best && typeof best.r_km === "number" && typeof best.el === "number") {
        const h = satAltKm(best.r_km, best.el, alt);
        if (isFinite(h) && h > 0) return h;
      }
    }

    // 2) 实时位置数据
    if (currentPos && typeof currentPos.r_km === "number" && typeof currentPos.el === "number") {
      const h = satAltKm(currentPos.r_km, currentPos.el, alt);
      if (isFinite(h) && h > 0) return h;
    }

    // 3) 按卫星类型默认值（由 TLE 平均运动估算）
    const SAT_HEIGHT_KM = { iss: 420, css: 400 };
    return SAT_HEIGHT_KM[satellite] || 400;
  }

  // 地面站可视范围圆（含极套环处理，避免 ±180° 接缝竖线）
  useEffect(() => {
    const src = stationFootprintSourceRef.current;
    if (!src) return;
    src.clear();
    stationFootFRef.current = null;
    if (!showVisibility) return;

    const h = resolveSatHeight();
    const maxLatDeg = proj === "EPSG:4326" ? 90 : 85;
    const items = computeFootprint(lat, lon, h, 0, 3, maxLatDeg);
    stationFootFRef.current = [];
    items.forEach(({ ring, collar, boundaryArc }) => {
      const toMap = toMapRef.current;
      const f = new Feature(new Polygon([ring.map(([lo, la]) => toMap(lo, la))]));
      // 含极"全经度套环"不描边，单独用边界弧描边，避免 ±180° 接缝出现竖线
      if (collar) {
        f.setStyle(new Style({ fill: new Fill({ color: "rgba(56, 189, 248, 0.15)" }) }));
      }
      stationFootFRef.current.push(f);
      src.addFeature(f);
      if (collar && boundaryArc) {
        const line = new Feature(new LineString(boundaryArc.map(([lo, la]) => toMap(lo, la))));
        line.setStyle(
          new Style({ stroke: new Stroke({ color: "rgba(56, 189, 248, 0.85)", width: 2 }) })
        );
        stationFootFRef.current.push(line);
        src.addFeature(line);
      }
    });
  }, [showVisibility, lat, lon, alt, currentPos, proj, satellite, activePass, gt,
      stationFootprintSourceRef, mapObjRef]); // eslint-disable-line react-hooks/exhaustive-deps
}
