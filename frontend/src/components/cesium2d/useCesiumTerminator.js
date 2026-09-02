// Cesium 2D 晨昏线光照效果 hook：夜半球阴影 + 橙黄虚线分界。
// 复用 components/terminator.js 的天文数学（纯函数），用 Cesium 实体在 SCENE2D 平面绘制：
//   - 夜影：晨昏线曲线 + 顶部/底部封口构成的闭合多边形（覆盖全经度）
//   - 虚线：晨昏线本体的橙色虚线（PolylineDashMaterialProperty）
// 实时模式每 30s 刷新（随真实时间缓慢移动）；推演模式随时间轴当前点变化。
import { useEffect, useRef, useState } from "react";
import { Cesium } from "../globe3d/cesiumGlobal.js";
import { sunPosition, terminatorLat } from "../terminator.js";

export function useCesiumTerminator({
  viewerRef,
  cesiumState,
  showTerminator,
  terminatorShowDashed,
  liveMode,
  idx,
  gt,
}) {
  const nightRef = useRef(null);   // 夜半球阴影 polygon 实体
  const dashedRef = useRef(null);  // 晨昏线橙黄虚线实体

  // 实时时钟：每 30s 推进一次，驱动实时模式下晨昏线随真实时间缓慢移动
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;

    // 清理旧实体（数据/开关变化时重建）
    if (nightRef.current) { viewer.entities.remove(nightRef.current); nightRef.current = null; }
    if (dashedRef.current) { viewer.entities.remove(dashedRef.current); dashedRef.current = null; }
    if (!showTerminator) return;

    // 显示时刻：实时模式取真实当前时刻；推演模式取时间轴当前点
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
    // 2D Web Mercator 纬度窗口上限（Cesium 投影同样裁剪到约 ±85°）
    const maxLat = 85;
    const clamp = (v) => Math.max(-maxLat, Math.min(maxLat, v));

    const samples = 360;
    const curve = [];
    for (let i = 0; i <= samples; i++) {
      const lon = -180 + (i / samples) * 360;
      curve.push([lon, clamp(terminatorLat(d, sunLon, lon))]);
    }

    // 夜半球阴影：晨昏线 + 顶部/底部边封口成闭合多边形（全经度，Cesium 按世界副本渲染）
    const ring = curve.map((p) => Cesium.Cartesian3.fromDegrees(p[0], p[1], 1));
    ring.push(Cesium.Cartesian3.fromDegrees(180, nightNorth ? maxLat : -maxLat, 1));
    ring.push(Cesium.Cartesian3.fromDegrees(-180, nightNorth ? maxLat : -maxLat, 1));
    nightRef.current = viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ring),
        height: 1, // 极小高度：走普通 Primitive，避免 GroundPrimitive 在全经度面/2D 下异常
        material: Cesium.Color.fromCssColorString("rgba(0,0,30,0.32)"),
      },
    });

    // 晨昏线本体：橙黄虚线（可通过设置页关闭，仅保留夜影）
    if (terminatorShowDashed) {
      dashedRef.current = viewer.entities.add({
        polyline: {
          positions: curve.map((p) => Cesium.Cartesian3.fromDegrees(p[0], p[1], 2)),
          width: 1.6,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString("rgba(255,190,80,0.9)"),
            dashLength: 16,
            dashPattern: 0x0FF0, // 明暗间隔虚线
          }),
        },
      });
    }
  }, [viewerRef, cesiumState, showTerminator, terminatorShowDashed,
      liveMode, idx, gt, nowMs]);
}
