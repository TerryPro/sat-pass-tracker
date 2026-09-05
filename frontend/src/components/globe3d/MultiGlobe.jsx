// 多星座 3D 渲染组件（Cesium）：大量卫星以其真实三维轨道位置悬浮显示 + 选中星轨道线。
// 卫星位置由父级用 SGP4 算出 ECI(惯性 J2000) 坐标；本组件按「坐标系模式」决定如何摆放：
//   - fixed（地固系）：用「显示时刻」的 ICRF→ECEF 矩阵把 ECI 转到地固系，地球固定、卫星相对地表移动；
//   - inertial（惯性系，仅 3D 有效）：卫星点同样转成 ECEF 世界坐标（Cesium 世界系是地固系），但相机每帧
//     变换到 ICRF 参考系，抵消地球自转——屏幕效果为轨道/卫星相对星空固定、地球自转。
// 大量卫星用 PointPrimitiveCollection（高性能，可千点）。
// 本组件只做装配：viewer 生命周期 / 场景设置 / 时钟控件 / 卫星点 / 轨道线 / 惯性相机均拆分为 hooks。
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { Cesium, loadCesium } from "./cesiumGlobal.js";
import { useViewerLifecycle } from "./useViewerLifecycle.js";
import { useSceneSettings } from "./useSceneSettings.js";
import { useClockControls } from "./useClockControls.js";
import { useSatellitePoints } from "./useSatellitePoints.js";
import { useOrbitLines } from "./useOrbitLines.js";
import { useInertialCamera } from "./useInertialCamera.js";

const MultiGlobe = React.forwardRef(function MultiGlobe(
  {
    positions = [],       // [{ norad, name, eci:{x,y,z}, isValid }]
    orbits = [],          // [{ norad, name, path:[{eci:{x,y,z}, t}] }]
    displayDate = null,   // 显示时刻(Date)：由 Cesium 时钟驱动，父级每帧同步
    highlightNorad = null,
    onPickNorad = null,
    active = true,
    // 场景与底图设置：视图模式 / 底图 / 星空开关（受父级控制）
    viewMode = "3d",      // 3d|2d|columbus
    basemap = "natural_earth",// natural_earth|satellite|street|terrain|dark|nature|blackmarble|none
    skyOn = true,
    hdr = true,           // 高动态范围（scene.highDynamicRange，satvis 的 HDR）
    atmosphere = true,    // 大气散射（scene.skyAtmosphere，satvis 的 Atmosphere）
    lighting = true,      // 太阳光照与阴影（scene.globe.enableLighting）
    frame = "fixed",      // 坐标系：fixed（地固）| inertial（惯性，仅 3D 生效）
    onTimeChange = null,  // 时钟每帧同步：onTimeChange(Date)
    timeDisplay = "utc",  // Cesium 时间控件显示时区：utc | local
    getPositionsAt = null, // (Date) => [{ norad, eci, isValid }]：按时刻插值全组位置（每帧同步卫星点）
    trackSat = false,     // 相机跟踪选中卫星（仅地固系生效；惯性由 ICRF 相机变换接管）
    orbitColor = "rgba(255,180,70,0.55)", // 普通轨道线颜色（设置页可配置）
    showNames = false,    // 是否在 3D 卫星点上显示卫星名字标签
  },
  ref
) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [state, setState] = useState("loading"); // loading|ready|error

  // 卫星点/标签集合的共享引用（useSatellitePoints 与 useClockControls 共同读写）
  const pointsRef = useRef([]);
  const noradToPointRef = useRef({});
  const pointsCollectionRef = useRef(null);
  const labelsCollectionRef = useRef(null);
  const noradToLabelRef = useRef({});
  const lastCountRef = useRef(-1);
  // 轨道线实体引用（useOrbitLines 管理）
  const orbitEntitiesRef = useRef([]);
  const highlightOrbitRef = useRef(null);
  // 惯性模式是否生效（惯性 && 3D），供轨道线/卫星点/时钟每帧区分转换方式
  const inertialRef = useRef(false);
  inertialRef.current = frame === "inertial" && viewMode === "3d";

  // Cesium 惰性加载
  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then(() => !cancelled && setState("ready"))
      .catch((e) => !cancelled && setState(String((e && e.message) || e)));
    return () => { cancelled = true; };
  }, []);

  useViewerLifecycle({ active, state, containerRef, viewerRef, onPickNorad });
  useSceneSettings({ viewerRef, state, viewMode, basemap, skyOn, hdr, atmosphere, lighting });
  useClockControls({
    viewerRef, state, timeDisplay,
    onTimeChange, trackSat, highlightNorad, inertialRef, noradToPointRef,
  });
  useSatellitePoints({
    viewerRef, state,
    positions, displayDate, highlightNorad, inertialRef, getPositionsAt, showNames,
    pointsRef, noradToPointRef, pointsCollectionRef, labelsCollectionRef, noradToLabelRef, lastCountRef,
  });
  useOrbitLines({
    viewerRef, state,
    orbits, orbitColor, highlightNorad, inertialRef,
    orbitEntitiesRef, highlightOrbitRef,
  });
  useInertialCamera({ viewerRef, state, frame, viewMode });

  // 暴露给父级：setTime 设置时钟（供「回到当前」等使用）
  React.useImperativeHandle(ref, () => ({
    setTime: (d) => {
      const v = viewerRef.current;
      if (v) v.clock.currentTime = Cesium.JulianDate.fromDate(d);
    },
  }), []);

  if (state !== "ready" && state !== "loading") {
    return <Box sx={{ p: 2, color: "#f87171", fontSize: 13 }}>{state}</Box>;
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
      <Box
        ref={containerRef}
        sx={{ flex: 1, minHeight: 0, width: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid", borderColor: "divider", bgcolor: "#000" }}
      />
      {state === "loading" && (
        <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 13 }}>
          加载 3D 视图…
        </Box>
      )}
    </Box>
  );
});

export default MultiGlobe;
