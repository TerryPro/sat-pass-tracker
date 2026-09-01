// 2D 地图：完整星下点轨迹图层 hook。
// 按圈拆分，每圈画成一条独立线段并统一单色（不再按圈分色）。
// 每圈的经度都落在标准 [-180,180] 内，配合 wrapX 既能画全所有圈，又在 ±180° 处
// 由 wrapX 衔接而不出现颜色跳变的断点。
import { useEffect, useRef } from "react";
import { fromLonLat } from "ol/proj";
import { segmentAndBuildFeatures } from "../trackgeo.js";

export function useTrackLayer({ mapObjRef, trackSourceRef, gt, proj, visibleHours }) {
  const toMapRef = useRef(null);
  toMapRef.current = (pLon, pLat) =>
    proj === "EPSG:4326" ? [pLon, pLat] : fromLonLat([pLon, pLat]);

  useEffect(() => {
    const src = trackSourceRef.current;
    if (!src || !gt) return;
    src.clear();
    // 过滤时间窗口：仅渲染从首点起 N 小时内的轨迹
    const startT = gt.points.length ? new Date(gt.points[0].t).getTime() : 0;
    const cutoff = startT + visibleHours * 3600 * 1000;
    const filtered = gt.points.filter((p) => new Date(p.t).getTime() <= cutoff);
    if (!filtered.length) return;
    const byOrbit = {};
    filtered.forEach((p) => {
      (byOrbit[p.orbit] = byOrbit[p.orbit] || []).push(p);
    });
    Object.entries(byOrbit).forEach(([orbit, pts]) => {
      const fs = segmentAndBuildFeatures(pts, toMapRef.current, Number(orbit), proj === "EPSG:4326");
      fs.forEach((f) => src.addFeature(f));
    });
  }, [gt, proj, visibleHours, trackSourceRef, mapObjRef]);
}
