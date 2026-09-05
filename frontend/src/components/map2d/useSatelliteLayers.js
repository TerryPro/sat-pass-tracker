// 2D 地图：卫星位置点 + 卫星可视范围（覆盖圆）图层 hook。
// 两者共用同一数据源选择（实时=Socket 推送，播放=时间轴当前索引点）与位置兜底缓存。
import { useEffect, useRef } from "react";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import { Circle, Fill, Stroke, Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { mapIsDark } from "../mapStyles.js";
import { computeFootprint, satAltKm } from "../trackgeo.js";

export function useSatelliteLayers({
  mapObjRef, posSourceRef, footprintSourceRef,
  liveMode, currentPos, idx, gt, proj, theme, alt, onHover,
}) {
  const realFRef = useRef(null);       // 卫星位置 feature（实时/播放共用）
  const realFootRef = useRef(null);    // 卫星覆盖圆 feature（实时/播放共用）
  const lastSatPosRef = useRef(null);  // 最后一次有效卫星位置缓存，用于兜底避免标记短暂消失
  const toMapRef = useRef(null);
  toMapRef.current = (pLon, pLat) =>
    proj === "EPSG:4326" ? [pLon, pLat] : fromLonLat([pLon, pLat]);

  // 卫星位置点（统一单标记）：实时模式用 currentPos，播放模式用 gt.points[idx]；统一橙色
  useEffect(() => {
    const src = posSourceRef.current;
    if (!src) return;
    // 根据模式选取数据源：实时=Socket 推送位置；播放=时间轴当前索引点（越界保护）
    let p = liveMode ? currentPos : null;
    if (!liveMode && gt && gt.points && gt.points.length) {
      p = gt.points[Math.min(idx, gt.points.length - 1)];
    }
    let pos = p;
    if (!pos || typeof pos.lat !== "number" || !isFinite(pos.lat)) {
      // 数据暂缺（如切换/重载瞬间 Socket 未回包）时用上一次有效位置兜底，避免标记消失
      pos = lastSatPosRef.current;
    }
    if (!pos || typeof pos.lat !== "number" || !isFinite(pos.lat)) return;
    lastSatPosRef.current = pos;
    const coord = toMapRef.current(pos.lon, pos.lat);
    if (!coord || !isFinite(coord[0]) || !isFinite(coord[1])) return;
    if (!realFRef.current) {
      const f = new Feature(new Point(coord));
      f.setStyle(
        new Style({
          image: new Circle({
            radius: 5,
            fill: new Fill({ color: "#f59e0b" }),
            // 描边随主题：暗色底图白边、亮色底图深棕边
            stroke: new Stroke({ color: mapIsDark() ? "#fff" : "#7c4a03", width: 1.5 }),
          }),
        })
      );
      realFRef.current = f;
      src.addFeature(f);
    } else {
      realFRef.current.getGeometry().setCoordinates(coord);
    }
    // 播放模式同步 hover 信息（实时模式 hover 由其他交互更新）
    if (!liveMode) onHover(pos);
  }, [liveMode, currentPos, idx, gt, proj, theme, posSourceRef, onHover]);

  // 卫星覆盖圆边界（统一单标记）：实时模式用 currentPos，播放模式用时间轴点；统一橙色
  // 只绘制边界、不填充半透明面：球冠填充跨 ±180° 时会在经线处出现条带/竖线且难以根治
  // （Cesium/OL 两引擎一致），因此用与地面站通视圆相同的 footprint.js 几何仅描轮廓。
  // 含极"全经度套环"不画套环本身（横跨整幅地图），只画远离极一侧的真实边界弧。
  useEffect(() => {
    const footSrc = footprintSourceRef.current;
    if (!footSrc) return;
    // 根据模式选取数据源，与卫星位置点保持一致（越界保护 + 缓存兜底）
    let p = liveMode ? currentPos : null;
    if (!liveMode && gt && gt.points && gt.points.length) {
      p = gt.points[Math.min(idx, gt.points.length - 1)];
    }
    if (!p || typeof p.lat !== "number" || !isFinite(p.lat)) {
      p = lastSatPosRef.current;
    }
    if (!p || typeof p.r_km !== "number" || typeof p.el !== "number") return;
    try {
      const h = satAltKm(p.r_km, p.el, alt);
      if (!isFinite(h) || h <= 0) return;
      const maxLatDeg = proj === "EPSG:4326" ? 90 : 85;
      const items = computeFootprint(p.lat, p.lon, h, 0, 3, maxLatDeg);
      // 环的结构签名（是否含极套环）：结构变化时需要重建 feature，否则仅更新几何
      const sig = items.map((it) => (it.collar ? 1 : 0)).join(",");
      const fs = realFootRef.current;
      if (!fs || fs.sig !== sig) {
        // 首次或结构变化：重建全部 feature（每组仅一个描边 feature）
        footSrc.clear();
        const groups = items.map(({ ring, collar, boundaryArc }) => {
          const toMap = toMapRef.current;
          const group = [];
          const stroke = new Style({
            stroke: new Stroke({ color: "rgba(245,158,11,0.8)", width: 1.5 }),
          });
          if (collar) {
            // 含极套环：只画真实边界弧（远离极一侧的小圆）
            if (boundaryArc && boundaryArc.length >= 2) {
              const line = new Feature(new LineString(boundaryArc.map(([lo, la]) => toMap(lo, la))));
              line.setStyle(stroke);
              group.push(line);
              footSrc.addFeature(line);
            }
          } else {
            // 普通闭合环：环线描边（不填充，避免跨 ±180° 条带）
            const f = new Feature(new Polygon([ring.map(([lo, la]) => toMap(lo, la))]));
            f.setStyle(stroke);
            group.push(f);
            footSrc.addFeature(f);
          }
          return group;
        });
        realFootRef.current = { sig, groups };
      } else {
        // 结构一致：仅更新几何，复用 feature 与样式
        items.forEach(({ ring, collar, boundaryArc }, i) => {
          const toMap = toMapRef.current;
          const group = fs.groups[i];
          if (!group[0]) return;
          if (collar) {
            if (boundaryArc && boundaryArc.length >= 2) {
              group[0].setGeometry(new LineString(boundaryArc.map(([lo, la]) => toMap(lo, la))));
            }
          } else {
            group[0].setGeometry(new Polygon([ring.map(([lo, la]) => toMap(lo, la))]));
          }
        });
      }
    } catch (e) {
      // 覆盖圆计算失败不影响位置点显示
    }
  }, [liveMode, currentPos, idx, gt, proj, alt, footprintSourceRef]);
}
