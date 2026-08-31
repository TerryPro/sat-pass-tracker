// 多星座 3D 渲染组件（Cesium）：大量卫星以其真实三维轨道位置悬浮显示 + 选中星轨道线。
// 消除重绘闪烁的设计：
//   - 卫星点集合只建一次，播放推进时【增量】更新每点 position（不整组重建）。
//   - 轨道线实体只建一次，位置用 CallbackProperty 每帧按最新显示时刻换算（不 remove/add）。
// ECI(惯性 J2000) 由父级 SGP4 算出；本组件用 ICRF→Fixed 矩阵把 ECI 转到 ECEF(Cartesian)。
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { Cesium, loadCesium } from "./cesiumGlobal.js";
import { createViewer, loadImagery, resetCamera } from "./viewer.js";

// ECI(km) → ECEF 地心坐标（米），基于指定显示时刻的 ICRF→Fixed 矩阵。
// 防 NaN：任何分量非有限时返回地心 ZERO，避免 NaN 坐标进入 Cesium 导致渲染崩溃。
function eciToFixed(eci, displayDate) {
  if (!eci || !isFinite(eci.x) || !isFinite(eci.y) || !isFinite(eci.z)) {
    return Cesium.Cartesian3.ZERO;
  }
  const m = Cesium.Transforms.computeIcrfToFixedMatrix(Cesium.JulianDate.fromDate(displayDate));
  const ecCart = Cesium.Cartesian3.fromElements(eci.x * 1000, eci.y * 1000, eci.z * 1000);
  if (!m) return ecCart;
  return Cesium.Matrix3.multiplyByVector(m, ecCart, new Cesium.Cartesian3());
}

export default function MultiGlobe({
  positions = [],       // [{ norad, name, eci:{x,y,z}, isValid }]
  orbits = [],          // [{ norad, name, path:[{eci:{x,y,z}}] }]
  displayDate = null,   // 显示时刻(Date)
  highlightNorad = null,
  onPickNorad = null,
  active = true,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const createdRef = useRef(false);
  const resizeObserverRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const [state, setState] = useState("loading"); // loading|ready|error

  const pointsCollectionRef = useRef(null);      // PointPrimitiveCollection（只建一次）
  const noradToPointRef = useRef({});            // norad -> PointPrimitive
  const orbitEntitiesRef = useRef([]);           // 轨道线 entity（只建一次）

  // 用 ref 保存最新 displayDate，供轨道线 CallbackProperty 闭包读取
  const displayRef = useRef(displayDate);
  displayRef.current = displayDate;

  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then(() => !cancelled && setState("ready"))
      .catch((e) => !cancelled && setState(String((e && e.message) || e)));
    return () => { cancelled = true; };
  }, []);

  // 懒创建 Viewer
  useEffect(() => {
    if (!active || state !== "ready" || createdRef.current || !containerRef.current) return;
    const viewer = createViewer(containerRef.current);
    viewerRef.current = viewer;
    createdRef.current = true;
    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;
    loadImagery(viewer);
    resetCamera(viewer, 0, 20000000);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      if (picked && picked.primitive && picked.primitive.id !== undefined) {
        onPickNorad && onPickNorad(picked.primitive.id);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    clickHandlerRef.current = handler;

    return () => {
      if (clickHandlerRef.current) { clickHandlerRef.current.destroy(); clickHandlerRef.current = null; }
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      if (pointsCollectionRef.current) { viewer.scene.primitives.remove(pointsCollectionRef.current); pointsCollectionRef.current.destroy(); }
      viewer.destroy();
      viewerRef.current = null;
      createdRef.current = false;
      pointsCollectionRef.current = null;
      noradToPointRef.current = {};
      orbitEntitiesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state]);

  // 卫星位置：增量更新，不整体重建 collection
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready" || !displayDate) return;
    const normal = Cesium.Color.fromCssColorString("rgba(63,200,255,0.9)");
    const selected = Cesium.Color.ORANGE;

    // 首次：创建 collection
    if (!pointsCollectionRef.current) {
      const coll = new Cesium.PointPrimitiveCollection();
      pointsCollectionRef.current = coll;
      viewer.scene.primitives.add(coll);
      noradToPointRef.current = {};
    }
    const coll = pointsCollectionRef.current;
    const seen = new Set();
    positions.forEach((p) => {
      if (!p || !p.eci || !p.isValid || !isFinite(p.eci.x)) return;
      seen.add(p.norad);
      let pt = noradToPointRef.current[p.norad];
      if (!pt) {
        pt = coll.add({
          position: Cesium.Cartesian3.ZERO,
          pixelSize: p.norad === highlightNorad ? 8 : 4,
          color: p.norad === highlightNorad ? selected : normal,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          id: p.norad,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        noradToPointRef.current[p.norad] = pt;
      }
      // 增量更新位置（避免整组重建闪烁）
      pt.position = new Cesium.ConstantPositionProperty(eciToFixed(p.eci, displayDate));
      // 颜色/大小随选中态（低成本）
      pt.pixelSize = p.norad === highlightNorad ? 8 : 4;
      pt.color = p.norad === highlightNorad ? selected : normal;
    });
    // 移除已不存在的星
    for (const norad of Object.keys(noradToPointRef.current)) {
      const n = Number(norad);
      if (!seen.has(n)) {
        coll.remove(noradToPointRef.current[norad]);
        delete noradToPointRef.current[norad];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, highlightNorad, displayDate, state]);

  // 轨道线：只建一次，位置用 CallbackProperty 每帧按最新 displayDate 换算（不重绘）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    orbitEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    orbitEntitiesRef.current = [];
    if (!orbits.length) return;
    const color = Cesium.Color.fromCssColorString("rgba(255,180,70,0.55)");
    orbits.forEach((o) => {
      if (!o.path || o.path.length < 2) return;
      const path = o.path;
      const positions = new Cesium.CallbackProperty(() => {
        const t = displayRef.current;
        if (!t) return undefined;   // 无显示时刻时返回 undefined，避免空数组触发 Cesium 内部错误
        return path.map((p) => eciToFixed(p.eci, t));
      }, false);
      const e = viewer.entities.add({
        polyline: { positions, width: 1.5, material: color },
      });
      orbitEntitiesRef.current.push(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbits, state]);

  // 隐藏切回时刷新尺寸
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !active) return;
    const timers = [0, 60, 120, 300].map((ms) => setTimeout(() => viewer.resize(), ms));
    return () => timers.forEach(clearTimeout);
  }, [active]);

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
}
