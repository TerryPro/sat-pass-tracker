// 2D 地图：晨昏线图层 hook（夜半球阴影 + 橙黄虚线分界）。
// 推演模式取时间轴当前时刻，实时模式取真实时间；内部 30s 时钟驱动实时移动。
import { useEffect, useRef, useState } from "react";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import { Fill, Stroke, Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { sunPosition, terminatorLat } from "../terminator.js";

export function useTerminatorLayer({
  mapObjRef, terminatorSourceRef,
  showTerminator, liveMode, idx, gt, proj, terminatorShowDashed,
}) {
  // 实时时钟：每 30s 推进一次，驱动晨昏线随真实时间缓慢移动
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // 经纬度 → 当前投影下的地图坐标（EPSG:3857 需 Web Mercator 换算，EPSG:4326 直接用度）
  const toMapRef = useRef(null);
  toMapRef.current = (pLon, pLat) =>
    proj === "EPSG:4326" ? [pLon, pLat] : fromLonLat([pLon, pLat]);

  // 晨昏线：随实时/推演时间重绘；开关控制显示
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const layer = map.getLayers().getArray().find((l) => l.get("name") === "terminator");
    if (layer) layer.setVisible(showTerminator);
    const src = terminatorSourceRef.current;
    if (!src || !showTerminator) return;
    src.clear();

    // 推演模式取时间轴当前时刻，实时模式取真实当前时刻
    const ms = liveMode
      ? nowMs
      : gt && gt.points && gt.points[idx]
        ? new Date(gt.points[idx].t).getTime()
        : nowMs;
    if (!isFinite(ms)) return;

    const { decl, sunLon } = sunPosition(new Date(ms));
    // 南半球夏季（δ<0）南极进入白昼、北极进入黑夜；夜半球位于晨昏线以北，反之以南
    const d = Math.abs(decl) < 1e-6 ? (decl >= 0 ? 1e-6 : -1e-6) : decl;
    const nightNorth = d < 0;
    const maxLat = proj === "EPSG:4326" ? 90 : 85;
    const clamp = (v) => Math.max(-maxLat, Math.min(maxLat, v));

    const samples = 360;
    const curve = [];
    for (let i = 0; i <= samples; i++) {
      const lon = -180 + (i / samples) * 360;
      curve.push([lon, clamp(terminatorLat(d, sunLon, lon))]);
    }

    // 夜半球阴影：晨昏线 + 顶部/底部边封口成闭合多边形
    const toMap = toMapRef.current;
    const ring = curve.map((p) => [p[0], p[1]]);
    ring.push([180, nightNorth ? maxLat : -maxLat]);
    ring.push([-180, nightNorth ? maxLat : -maxLat]);
    ring.push([curve[0][0], curve[0][1]]);
    const night = new Feature(new Polygon([ring.map(([lon, la]) => toMap(lon, la))]));
    night.setStyle(new Style({ fill: new Fill({ color: "rgba(0,0,30,0.32)" }) }));
    src.addFeature(night);

    // 晨昏线本体：橙黄色虚线（可通过设置页关闭，仅保留夜影）
    if (terminatorShowDashed) {
      const line = new Feature(new LineString(curve.map(([lon, la]) => toMap(lon, la))));
      line.setStyle(
        new Style({ stroke: new Stroke({ color: "rgba(255,190,80,0.9)", width: 1.6, lineDash: [8, 5] }) })
      );
      src.addFeature(line);
    }
  }, [showTerminator, liveMode, idx, gt, proj, nowMs, terminatorShowDashed,
      mapObjRef, terminatorSourceRef]);
}
