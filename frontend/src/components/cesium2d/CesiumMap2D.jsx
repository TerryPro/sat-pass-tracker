// Cesium 2D 地图（对照引擎）：OpenLayers 2D 的 Cesium SCENE2D 替代实现，props 与 Map2D 一致。
// 投影固定 EPSG:4326，不提供投影切换（GroundTrack 对 Cesium 引擎隐藏投影下拉）。
// 轨道线/可见段用 scene.primitives 的 PolylineCollection 自绘以控制覆盖顺序；
// 地面站/通视圆/位置点复用 globe3d/render.js，与 Globe3D 同构，可与 Map2D 并行对照测试。
// 经纬网由 useGraticule（Graticules.js）实现，随 showGrid 开关显示/隐藏。
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { useSelector } from "react-redux";
import { Cesium, loadCesium } from "../globe3d/cesiumGlobal.js";
import { createViewer, setBasemap } from "../globe3d/viewer.js";
import { renderStationMarker, renderStationFootprint, renderRealPoint } from "../globe3d/render.js";
import { useCesiumTerminator } from "./useCesiumTerminator.js";
import { useGraticule } from "../globe3d/useGraticule.js";
import { useAppTheme } from "../../hooks/useAppTheme.js";

// 球面小圆环边界点（方位角均匀采样，供覆盖圆边界 polyline 使用）：
// 中心 lat/lon + 地心半角 beta（rad）→ 高度 heightM 处 [lon,lat] 对应的地心坐标序列（闭合）。
// 跨 ±180° 由 Cesium polyline 的 wrapLongitude 自动处理（与轨道线同一机制）。
function circleRingPositions(lat, lon, beta, heightM = 1, n = 128) {
  const latR = Cesium.Math.toRadians(lat);
  const lonR = Cesium.Math.toRadians(lon);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * 2 * Math.PI; // 方位角
    const sinLat = Math.sin(latR) * Math.cos(beta) + Math.cos(latR) * Math.sin(beta) * Math.cos(th);
    const la = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const dlon = Math.atan2(
      Math.sin(th) * Math.sin(beta) * Math.cos(latR),
      Math.cos(beta) - Math.sin(latR) * Math.sin(la)
    );
    pts.push(Cesium.Cartesian3.fromRadians(lonR + dlon, la, heightM));
  }
  return pts;
}

export default function CesiumMap2D({
  params,
  gt,
  passes,
  activeIdx,
  onSelect,
  activePass,
  currentPos,
  idx,
  liveMode,
  proj, // 忽略：投影固定 EPSG:4326
  showGrid, // 经纬网（未实现）
  showVisibility,
  passMode,
  mapStyle,
  visibleHours,
  showTerminator, // 晨昏线：原生光照阴影 + 橙色虚线分界
  active,
  sidebarVisible,
  onSetIdx = null, // 点击地图联动时间轴：onSetIdx(采样点索引)（与 Globe3D 一致）
}) {
  const { lat, lon, satellite } = params;

  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const createdRef = useRef(false);
  const resizeObserverRef = useRef(null);
  const clickHandlerRef = useRef(null); // 点击事件（点击地图 → 最近点 → 联动时间轴）
  const [cesiumState, setCesiumState] = useState("loading"); // loading|ready|error string

  // 应用主题（设置页 theme 字段）：轨迹/可见段配色随暗/亮主题
  const theme = useAppTheme();
  const themeDark = theme !== "light"; // 与 OL 的 mapIsDark() 一致

  // 各类实体引用（与 Globe3D 相同的渲染管线）
  const trackCollRef = useRef(null);   // 轨道线 + 可见段黄弧共用的 PolylineCollection（scene.primitives）
                                       // 同一集合内按添加顺序绘制：先轨道（淡）后黄弧（亮）→ 黄弧恒在轨道之上
  const markEntitiesRef = useRef([]);  // AOS/LOS 标注 entity（billboard 通道天然位于几何之上）
  const stationEntityRef = useRef(null);
  const footprintEntityRef = useRef(null);
  const realPointRef = useRef(null);
  const satFootRef = useRef(null); // 卫星覆盖圆边界（星下点可视范围轮廓）polyline entity
  const satPosRef = useRef(null); // 最新星下点 { lat, lon }（供覆盖圆边界 CallbackProperty 读取）
  const satBetaRef = useRef(0);   // 最新地心半角 β（rad）：覆盖圆半径随高度变化，供边界回调读取
  const ringCacheRef = useRef({ key: "", positions: [] }); // 边界圆环缓存：位置/β 未变时返回同一数组，避免每帧重建

  // 最新 gt / onSetIdx 经 ref 读取：点击 handler 空依赖创建，避免闭包过期
  const gtRef = useRef(gt);
  gtRef.current = gt;
  const onSetIdxRef = useRef(onSetIdx);
  onSetIdxRef.current = onSetIdx;

  // 晨昏线橘色虚线开关：来自用户持久化设置（设置页外观卡片中配置，与 OL 2D 同源）
  const terminatorShowDashed = useSelector(
    (s) => (s.settings?.values?.terminator_show_dashed ?? true) === true
  );

  // 单击地图联动开关（设置页"界面外观"）：默认关闭
  const clickEnabled = useSelector(
    (s) => (s.settings?.values?.map_click_link ?? false) === true
  );

  // Cesium 懒加载（仅一次）
  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then(() => !cancelled && setCesiumState("ready"))
      .catch((e) => !cancelled && setCesiumState(String((e && e.message) || e)));
    return () => { cancelled = true; };
  }, []);

  // 懒创建 Viewer（SCENE2D），并应用底图
  useEffect(() => {
    if (!active || cesiumState !== "ready" || createdRef.current || !containerRef.current) return;
    const viewer = createViewer(containerRef.current);
    viewerRef.current = viewer;
    createdRef.current = true;

    // 隐藏 Cesium 自带控件（动画/时间线由外层 TimelineBar 驱动）；2D 下关闭星空/大气与 HDR
    viewer.animation && (viewer.animation.container.style.display = "none");
    viewer.timeline && (viewer.timeline.container.style.display = "none");
    viewer.fullscreenButton && (viewer.fullscreenButton.container.style.display = "none");
    viewer.scene.skyBox.show = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
    viewer.scene.highDynamicRange = false;
    // 无瓦片区域底色（4326 全纬度 ±90° 下在线 WebMercator 底图只覆盖 ±85°，极区无瓦片）
    // 由 setBasemap 按底图深浅自适应设置（浅色底图浅海蓝 / 深色底图暗蓝）。
    // 光照（enableLighting）不在此设置：由下方 showTerminator effect 控制昼夜阴影随时钟着色
    // 超采样渲染：缓解 SCENE2D 下 polyline/ellipse 锯齿（2D 无 MSAA，靠提高分辨率换取平滑）
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
    setBasemap(viewer, mapStyle || "satellite");
    // 立即切到 2D（无动画）并缩放到全球范围（4326 全纬度 ±90°）
    viewer.scene.morphTo2D(0);
    viewer.camera.setView({
      destination: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
    });

    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;

    // 轨道线 + 可见段共用的 PolylineCollection（scene.primitives，独立于 entity 渲染排序）
    const trackColl = new Cesium.PolylineCollection();
    viewer.scene.primitives.add(trackColl);
    trackCollRef.current = trackColl;

    return () => {
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      viewer.destroy();
      viewerRef.current = null;
      createdRef.current = false;
      trackCollRef.current = null;
      markEntitiesRef.current = [];
      stationEntityRef.current = null;
      footprintEntityRef.current = null;
      realPointRef.current = null;
      satFootRef.current = null;
      satPosRef.current = null;
      satBetaRef.current = 0;
      ringCacheRef.current = { key: "", positions: [] };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cesiumState]);

  // 单击地图 → 时间轴跳到最近的轨迹采样点。
  // 由设置页"单击地图联动"开关控制（默认关闭），开关打开且 Viewer 就绪时才注册，
  // 避免误触与不必要的屏幕拾取开销；gt/onSetIdx 经 ref 读取，避免闭包过期。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready" || !active) return;
    if (!clickEnabled) {
      if (clickHandlerRef.current) { clickHandlerRef.current.destroy(); clickHandlerRef.current = null; }
      return;
    }
    if (clickHandlerRef.current) return; // 已注册（开关/视图状态未变时保持）
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const data = gtRef.current;
      const cb = onSetIdxRef.current;
      if (!data || !data.points || !data.points.length || !cb) return;
      const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      const lonDeg = Cesium.Math.toDegrees(carto.longitude);
      const latDeg = Cesium.Math.toDegrees(carto.latitude);
      let bestIdx = 0;
      let bestD = Infinity;
      data.points.forEach((p, i) => {
        const d = (p.lon - lonDeg) ** 2 + (p.lat - latDeg) ** 2;
        if (d < bestD) { bestD = d; bestIdx = i; }
      });
      cb(bestIdx);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    clickHandlerRef.current = handler;
    return () => {
      if (clickHandlerRef.current) { clickHandlerRef.current.destroy(); clickHandlerRef.current = null; }
    };
  }, [active, cesiumState, clickEnabled]);

  // 底图样式切换（mapStyle 即 Cesium key）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    setBasemap(viewer, mapStyle || "satellite");
  }, [mapStyle, cesiumState]);

  // 晨昏线光照（夜/昼阴影）：开关打开时 enableLighting=true，原生光照随时间推移产生移动阴影，关闭则无阴影
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    viewer.scene.globe.enableLighting = !!showTerminator;
    viewer.scene.requestRender();
  }, [showTerminator, cesiumState]);

  // 切回显示/侧栏变化后，按延迟序列刷新尺寸（等容器完成重排，避免首帧变形）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !active) return;
    const timers = [0, 60, 120, 300].map((ms) => setTimeout(() => viewer.resize(), ms));
    return () => timers.forEach(clearTimeout);
  }, [active, sidebarVisible]);

  // 场景时钟推进到"显示时刻"：实时=当前时刻；播放=时间轴当前点
  // （驱动原生光照阴影与晨昏线虚线随时钟着色/移动）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let tm;
    if (liveMode) {
      tm = Cesium.JulianDate.now();
    } else if (gt && gt.points && gt.points[idx]) {
      tm = Cesium.JulianDate.fromDate(new Date(gt.points[idx].t));
    } else {
      return;
    }
    viewer.clock.currentTime = tm;
    viewer.scene.requestRender();
  }, [liveMode, idx, gt]);

  // 轨道线 + 可见段黄弧统一绘制（核心）：共用 scene.primitives 的 PolylineCollection，
  // 集合内按添加顺序渲染（先轨道淡线、后黄弧亮线）→ 黄弧恒定在上，不受 translucent 跨集合排序影响。
  // 分 all/selected 两个 effect 驱动：all 模式 deps 不含 activePass（播放中稳定），selected 模式跨过境才重绘。
  const llh1 = (p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1);
  // PolylineCollection（primitive 层）的 material 必须是 Cesium.Material（不能直接传 Color）
  const colorMat = (c) => Cesium.Material.fromType(Cesium.Material.ColorType, { color: c });

  const drawTrackLines = () => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    const coll = trackCollRef.current;
    if (!coll) return;
    coll.removeAll();
    if (!gt || !gt.points || !gt.points.length) return;
    const dark = themeDark;
    const startT = new Date(gt.points[0].t).getTime();
    const cutoff = startT + visibleHours * 3600 * 1000;

    // 1) 完整轨迹（背景淡线，先添加 → 在下层）
    const trackPts = gt.points.filter((p) => new Date(p.t).getTime() <= cutoff);
    if (trackPts.length >= 2) {
      coll.add({
        positions: trackPts.map(llh1),
        width: 1,
        material: colorMat(Cesium.Color.fromCssColorString(dark ? "#6dc6ff" : "#0a66b0").withAlpha(0.45)),
      });
    }

    // 2) 可见段黄弧（后添加 → 覆盖在轨道线上方）
    let toDraw = [];
    if (passMode === "selected") {
      if (activePass) toDraw = [activePass];
    } else {
      toDraw = (passes || []).filter((pass) => {
        const tAos = new Date(pass.aos).getTime();
        const tLos = new Date(pass.los).getTime();
        return tLos >= startT && tAos <= cutoff;
      });
    }
    // 黄弧 alpha 0.999（<1）→ 与轨道线同属 translucent 桶（不同桶会按 opaque→translucent 分 pass，
    // 导致 alpha=1 的黄弧先画、被后画的半透明轨道盖住）。同桶 translucent 下按添加顺序后画覆盖。
    const hlMat = colorMat(Cesium.Color.fromCssColorString(dark ? "#ffc400" : "#b45309").withAlpha(0.999));
    for (const pass of toDraw) {
      const t0 = new Date(pass.aos).getTime();
      const t1 = new Date(pass.los).getTime();
      const vis = gt.points.filter((p) => {
        const t = new Date(p.t).getTime();
        return t >= t0 && t <= t1;
      });
      if (vis.length < 2) continue;
      coll.add({ positions: vis.map(llh1), width: 2, material: hlMat });
    }
  };

  // all 模式：黄弧随数据/窗口/模式/主题变化重绘（不含 activePass → 播放稳定）
  useEffect(() => {
    if (passMode !== "all") return;
    drawTrackLines();
  }, [passMode, gt, passes, visibleHours, themeDark, active, cesiumState]);

  // selected 模式：仅在跨过境（activePass 变化）时重绘当前黄弧
  useEffect(() => {
    if (passMode !== "selected") return;
    drawTrackLines();
  }, [passMode, activePass, gt, visibleHours, themeDark, active, cesiumState]);

  // AOS/LOS 标注（billboard 通道天然位于所有几何之上）
  const rebuildMarks = (list) => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    markEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    markEntitiesRef.current = [];
    if (!gt || !gt.points) return;
    const dark = themeDark;
    const labelFill = Cesium.Color.fromCssColorString(dark ? "#ffffff" : "#111827");
    const labelHalo = Cesium.Color.fromCssColorString(dark ? "#000000" : "#ffffff");
    for (const pass of list) {
      const t0 = new Date(pass.aos).getTime();
      const t1 = new Date(pass.los).getTime();
      const vis = gt.points.filter((p) => {
        const t = new Date(p.t).getTime();
        return t >= t0 && t <= t1;
      });
      if (vis.length < 2) continue;
      const mk = (p, text, color) => {
        const e = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1),
          point: { pixelSize: 8, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5 },
          label: {
            text,
            font: "bold 12px sans-serif",
            pixelOffset: new Cesium.Cartesian2(0, -18),
            fillColor: labelFill,
            outlineColor: labelHalo,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          },
        });
        markEntitiesRef.current.push(e);
      };
      mk(vis[0], "AOS", Cesium.Color.RED);
      mk(vis[vis.length - 1], "LOS", Cesium.Color.LIME);
    }
  };

  // all 模式标注（不依赖 activePass → 播放稳定）
  useEffect(() => {
    if (passMode !== "all") return;
    const startT = gt && gt.points.length ? new Date(gt.points[0].t).getTime() : 0;
    const cutoff = startT + visibleHours * 3600 * 1000;
    const list = (passes || []).filter((pass) =>
      new Date(pass.los).getTime() >= startT && new Date(pass.aos).getTime() <= cutoff);
    rebuildMarks(list);
  }, [passMode, gt, passes, visibleHours, themeDark, active, cesiumState]);

  // selected 模式标注：activePass 变化（跨过境）时重建当前两条
  useEffect(() => {
    rebuildMarks(passMode === "selected" && activePass ? [activePass] : []);
  }, [passMode, activePass, gt, themeDark, active, cesiumState]);

  // 地面站静态标记（仅站点坐标变化时重建，避免随实时位置高频重建闪烁）
  useEffect(() => {
    renderStationMarker({
      viewer: viewerRef.current,
      lat,
      lon,
      stationRef: stationEntityRef,
    });
  }, [lat, lon, active, cesiumState]);

  // 地面站通视圆（随卫星高度源/开关变化重建）
  useEffect(() => {
    renderStationFootprint({
      viewer: viewerRef.current,
      gt,
      lat,
      lon,
      showVisibility,
      satellite,
      activePass,
      currentPos,
      footprintRef: footprintEntityRef,
      maxLatDeg: 90, // 4326 全球纬度 ±90°
    });
  }, [showVisibility, satellite, activePass, currentPos, gt, active, cesiumState]);

  // 卫星位置点（实时/播放统一橙点；2D 星下点页画在地表）
  useEffect(() => {
    renderRealPoint({
      viewer: viewerRef.current,
      gt,
      liveMode,
      currentPos,
      idx,
      eci: false,
      surface: true,
      pointRef: realPointRef,
    });
  }, [liveMode, currentPos, idx, gt, active, cesiumState]);

  // 卫星覆盖圆边界（星下点可视范围轮廓，常显橙色，与 OL 2D 一致）：
  // 覆盖圆 = 卫星处 0° 仰角可通视的地表球冠，地心半角 β = acos(R/(R+h))。
  // 只描边界圆环、不绘制半透明填充面：填充若用 Cesium 平面 EllipseGeometry，在覆盖圆
  // 跨 ±180°（高轨大覆盖，如 GEO/IGSO）时会产生贯穿整幅地图的条带，难以根治；
  // 球面面积的正确填充又需要按经线/极区切分（footprint.js）。故改用与轨道线一致的
  // polyline 圆环表达可视范围边界，简单且无条带。
  // 性能/同步：圆环只创建一次，positions 用 CallbackProperty 惰性求值并缓存，
  // 位置/β 未变时返回同一数组，Cesium 不重建几何（播放/实时移动零闪烁）。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    const p = liveMode ? currentPos : (gt && gt.points[idx]);
    if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") return;
    if (!(p.alt_km > 0)) return;
    satPosRef.current = { lat: p.lat, lon: p.lon };
    const R = 6371e3; // 地球半径（米）
    satBetaRef.current = Math.acos(Math.min(1, R / (R + p.alt_km * 1000))); // 地心半角（rad）
    if (satFootRef.current) return; // 已创建：仅更新位置/β ref，边界由 CallbackProperty 惰性取用
    const lineCB = new Cesium.CallbackProperty(() => {
      const s = satPosRef.current;
      if (!s) return ringCacheRef.current.positions;
      const beta = satBetaRef.current;
      const key = `${s.lat.toFixed(4)}|${s.lon.toFixed(4)}|${beta.toFixed(6)}`;
      if (key !== ringCacheRef.current.key) {
        ringCacheRef.current = { key, positions: circleRingPositions(s.lat, s.lon, beta) };
      }
      return ringCacheRef.current.positions; // 同一引用 → Cesium 不重建几何，静止零开销
    }, false);
    satFootRef.current = viewer.entities.add({
      polyline: {
        positions: lineCB,
        width: 2,
        material: Cesium.Color.fromCssColorString("rgba(245,158,11,0.95)"),
      },
    });
  }, [liveMode, currentPos, idx, gt, active, cesiumState]);

  // 晨昏线虚线分界（阴影由上方 enableLighting 光照渲染，此处仅叠加橙色虚线）
  useCesiumTerminator({
    viewerRef,
    cesiumState,
    showTerminator,
    terminatorShowDashed,
    liveMode,
  });

  // 经纬网（Graticule）：随 showGrid 开关显示/隐藏
  useGraticule({ viewerRef, state: cesiumState, active, showGrid });

  if (cesiumState !== "ready" && cesiumState !== "loading") {
    return <Box sx={{ p: 2, color: "#f87171", fontSize: 13 }}>{cesiumState}</Box>;
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          borderRadius: "8px",
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "#000",
        }}
      />
      {cesiumState === "loading" && (
        <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 13 }}>
          加载 2D 视图（Cesium）…
        </Box>
      )}
    </Box>
  );
}
