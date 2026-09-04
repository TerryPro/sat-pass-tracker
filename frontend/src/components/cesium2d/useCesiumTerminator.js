// Cesium 2D 晨昏线虚线分界 hook：仅绘制橙黄虚线（设置页 terminator_show_dashed 可关闭）。
// 夜/昼阴影不在此手绘：由 CesiumMap2D 的 globe.enableLighting 原生光照随时钟着色渲染。
// 虚线实体只创建一次，polyline.positions 用 CallbackProperty 惰性求值：
// 实时=真实时间（节流 30s），推演=场景时钟 currentTime（由 CesiumMap2D 随时间轴写入）。
// 时刻未跨阈值时返回同一引用（Cesium 不重建几何），变化时才重算并返回新数组触发平滑重建（不闪烁）。
import { useEffect, useRef } from "react";
import { Cesium } from "../globe3d/cesiumGlobal.js";
import { sunPosition, terminatorLat } from "../terminator.js";

// 计算给定时刻的晨昏线虚线位置序列（Cartesian3 数组，纬度裁剪到 maxLat ±90°）
function buildDashedPositions(ms) {
  const { decl, sunLon } = sunPosition(new Date(ms));
  const d = Math.abs(decl) < 1e-6 ? (decl >= 0 ? 1e-6 : -1e-6) : decl;
  const maxLat = 90;
  const clamp = (v) => Math.max(-maxLat, Math.min(maxLat, v));
  const samples = 360;
  const positions = [];
  for (let i = 0; i <= samples; i++) {
    const lon = -180 + (i / samples) * 360;
    positions.push(Cesium.Cartesian3.fromDegrees(lon, clamp(terminatorLat(d, sunLon, lon)), 2));
  }
  return positions;
}

export function useCesiumTerminator({
  viewerRef,
  cesiumState,
  showTerminator,
  terminatorShowDashed,
  liveMode,
}) {
  const dashedRef = useRef(null);    // 虚线实体（仅创建一次，后续只更新几何）
  const positionsRef = useRef([]);   // 最近一次计算的虚线 positions（供 CallbackProperty 返回）
  const lastMsRef = useRef(null);    // 最近一次已绘制时刻（ms），用于节流
  const liveRef = useRef(liveMode);  // 供帧内回调读取最新模式
  liveRef.current = liveMode;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    // 未开启晨昏线或关闭虚线分界 → 移除虚线（只保留原生光照阴影或纯底图）
    if (!showTerminator || !terminatorShowDashed) {
      if (dashedRef.current) {
        viewer.entities.remove(dashedRef.current);
        dashedRef.current = null;
      }
      return;
    }
    // 已创建则无需重建（positions 由 CallbackProperty 惰性更新）
    if (dashedRef.current) return;

    // positions 惰性求值：Cesium 每帧在渲染循环内调用本回调
    const posCB = new Cesium.CallbackProperty(() => {
      let ms;
      if (liveRef.current) {
        ms = Date.now(); // 实时：真实时间
      } else if (viewer.clock && viewer.clock.currentTime) {
        ms = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime(); // 推演：场景时钟（与光照同源）
      } else {
        return positionsRef.current;
      }
      if (!isFinite(ms)) return positionsRef.current;
      // 节流：实时太阳移动慢（30s 一次）；推演按时刻精确变化（idx 拖动/播放即变）
      const minStep = liveRef.current ? 30000 : 0;
      if (lastMsRef.current !== null && Math.abs(ms - lastMsRef.current) < minStep) {
        return positionsRef.current; // 返回同一引用 → Cesium 不重建几何，静止零开销
      }
      lastMsRef.current = ms;
      positionsRef.current = buildDashedPositions(ms); // 新数组 → 触发一次平滑重建
      return positionsRef.current;
    }, false);

    dashedRef.current = viewer.entities.add({
      polyline: {
        positions: posCB,
        width: 1.6,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("rgba(255,190,80,0.9)"),
          dashLength: 16,
          dashPattern: 0x0FF0, // 明暗间隔虚线
        }),
      },
    });

    return () => {
      if (dashedRef.current) {
        // Viewer 可能已被外层销毁（cleanup 顺序），安全移除
        try {
          viewer.entities.remove(dashedRef.current);
        } catch (_) {
          /* Viewer 已销毁，忽略 */
        }
        dashedRef.current = null;
      }
      lastMsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRef, cesiumState, showTerminator, terminatorShowDashed]);
}
