// Cesium 2D 地图（对照引擎，OpenLayers 2D 的 Cesium SCENE2D 替代实现）。
// props 与 Map2D 完全一致；固定 Web Mercator（EPSG:3857），不提供投影切换。
// 渲染复用 globe3d/render.js 的实体管线（renderTrack/renderPasses/renderStation/renderRealPoint），
// 因此与 3D 视图（Globe3D）天然同构，可与 Map2D 并行对照测试。
//
// 迁移进度（阶段式，见方案）：
//   [x] P0：底图 / 地表轨迹 / 可见段高亮+AOS·LOS / 地面站+通视圆 / 卫星位置点
//   [x] P1：晨昏线（夜影+虚线）
//   [ ] P1：经纬网
//   [ ] P2：点击查询联动、时间轴双向同步细节
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { useSelector } from "react-redux";
import { Cesium, loadCesium } from "../globe3d/cesiumGlobal.js";
import { createViewer, setBasemap } from "../globe3d/viewer.js";
import { renderStationMarker, renderStationFootprint, renderRealPoint } from "../globe3d/render.js";
import { useCesiumTerminator } from "./useCesiumTerminator.js";
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
  proj, // 忽略：Cesium 2D 固定 Web Mercator
  showGrid, // P1：经纬网
  showVisibility,
  passMode,
  mapStyle,
  visibleHours,
  showTerminator, // P1：晨昏线
  active,
  sidebarVisible,
  onSetIdx = null, // 点击地图联动时间轴：onSetIdx(采样点索引)（与 Globe3D 一致）
}) {
  const { lat, lon, alt, satellite } = params;

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
  const satFootRef = useRef(null); // 卫星覆盖圆（星下点可视范围）{ entity, radius }
  const satPosRef = useRef(null); // 最新星下点 { lat, lon, altKm }（供覆盖圆 CallbackProperty 每帧读取）

  // 最新 gt / onSetIdx 经 ref 读取：点击 handler 空依赖创建，避免闭包过期
  const gtRef = useRef(gt);
  gtRef.current = gt;
  const onSetIdxRef = useRef(onSetIdx);
  onSetIdxRef.current = onSetIdx;

  // 晨昏线橘色虚线开关：来自用户持久化设置（设置页外观卡片中配置，与 OL 2D 同源）
  const terminatorShowDashed = useSelector(
    (s) => (s.settings?.values?.terminator_show_dashed ?? true) === true
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

    // 2D 平面视图：隐藏 Cesium 自带的动画/时间线控件（时间轴由 GroundTrack 的 TimelineBar 统一驱动）
    viewer.animation && (viewer.animation.container.style.display = "none");
    viewer.timeline && (viewer.timeline.container.style.display = "none");
    viewer.fullscreenButton && (viewer.fullscreenButton.container.style.display = "none");
    // 2D 无光照/大气意义：关闭 enableLighting 避免影像被太阳照出一侧明暗；同时关星空与大气
    viewer.scene.globe.enableLighting = false;
    viewer.scene.skyBox.show = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
    viewer.scene.highDynamicRange = false; // 2D 影像保持原色，避免 HDR 造成明暗偏差
    // 超采样渲染：缓解 Cesium SCENE2D 下 polyline/ellipse 的锯齿（2D 无 MSAA，靠提高分辨率换取平滑）
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
    setBasemap(viewer, mapStyle || "satellite"); // mapStyle 即 Cesium key（与运行态势页共用）
    // 立即切到 2D（duration=0 无动画），并缩放到全球范围
    viewer.scene.morphTo2D(0);
    viewer.camera.setView({
      destination: Cesium.Rectangle.fromDegrees(-180, -85, 180, 85),
    });

    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;

    // 轨道线 + 可见段共用的 PolylineCollection（scene.primitives，独立于 entity 渲染排序）
    const trackColl = new Cesium.PolylineCollection();
    viewer.scene.primitives.add(trackColl);
    trackCollRef.current = trackColl;

    // 点击地图 → 找到最近的轨迹采样点并联动时间轴（与 Globe3D 一致；
    // gt/onSetIdx 经 ref 读取，避免创建时的闭包过期）
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cesiumState]);

  // 底图样式切换（mapStyle 即 Cesium key）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    setBasemap(viewer, mapStyle || "satellite");
  }, [mapStyle, cesiumState]);

  // 从隐藏切回显示时刷新尺寸
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !active) return;
    const timers = [0, 60, 120, 300].map((ms) => setTimeout(() => viewer.resize(), ms));
    return () => timers.forEach(clearTimeout);
  }, [active, sidebarVisible]);

  // 场景时钟推进到"显示时刻"：实时=当前时刻；播放=时间轴当前点
  // （2D 下光照无意义，但时钟驱动后续晨昏线/位置标注等按时刻计算）
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

  // 轨道线 + 可见段黄弧统一绘制（核心）：放入同一个 scene.primitives 的 PolylineCollection，
  // 集合内部严格按添加顺序渲染（先轨道淡线 → 后黄弧亮线）→ 黄弧恒定画在轨道线上方，
  // 不再受 Cesium translucent 跨集合排序影响。
  // 由两个 effect 驱动，避免 all 模式播放时 activePass 变化触发全量重绘：
  //   - all 模式：deps 不含 activePass → 播放中稳定
  //   - selected 模式：activePass 变化（跨过境）才重绘
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

  // 地面站通视圆（随卫星高度源/开关变化重建；2D Web Mercator 纬度窗口 ±85°）
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
      maxLatDeg: 85,
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

  // 卫星覆盖圆（星下点可视范围，常显橙色，与 OL 2D 一致）：
  // 覆盖圆 = 卫星处 0° 仰角可通视的地表球冠，地心半角 β = acos(R/(R+h))。
  // 实现：ellipse 仅做半透明填充（ellipse 几何的 outline 固定 1px 无法加粗），
  // 边界线用独立 polyline 圆环绘制（width 可调，跨 ±180° 自动 wrap）。
  // 性能/同步：position/圆环均用 CallbackProperty 读 satPosRef 每帧更新（与轨道线同帧），
  // 几何（β 半径）仅在高度明显变化时重建，播放中几乎不触发。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    const p = liveMode ? currentPos : (gt && gt.points[idx]);
    if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") return;
    if (!(p.alt_km > 0)) return;
    satPosRef.current = { lat: p.lat, lon: p.lon, altKm: p.alt_km };

    const R = 6371e3; // 地球半径（米）
    const beta = Math.acos(Math.min(1, R / (R + p.alt_km * 1000))); // 地心半角（rad）
    const radius = beta * R; // 球面弧长半径（米）

    const cur = satFootRef.current;
    // 高度明显变化（覆盖圆半径显著改变）或尚未创建 → 重建几何；否则几何复用，仅位置/圆环由 CallbackProperty 跟随
    if (!cur || Math.abs(radius - cur.radius) > 0.02 * R) {
      if (cur) {
        viewer.entities.remove(cur.entity);
        if (cur.line) viewer.entities.remove(cur.line);
      }
      const posCB = new Cesium.CallbackProperty(() => {
        const s = satPosRef.current;
        return s
          ? Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 1)
          : Cesium.Cartesian3.fromDegrees(0, 0, 1);
      }, false);
      const lineCB = new Cesium.CallbackProperty(() => {
        const s = satPosRef.current;
        return s ? circleRingPositions(s.lat, s.lon, beta) : [];
      }, false);
      satFootRef.current = {
        entity: viewer.entities.add({
          position: posCB,
          ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            height: 1,
            material: Cesium.Color.fromCssColorString("rgba(245,158,11,0.18)"),
            // granularity 是弧度步长（越小越密）：0.005 rad ≈ 0.29°，约 1256 个采样点，填充圆滑
            granularity: 0.005,
          },
        }),
        // 边界线：独立 polyline（宽 2px，明显于椭圆自带 1px 几何描边）
        line: viewer.entities.add({
          polyline: {
            positions: lineCB,
            width: 2,
            material: Cesium.Color.fromCssColorString("rgba(245,158,11,0.95)"),
          },
        }),
        radius,
      };
    }
  }, [liveMode, currentPos, idx, gt, active, cesiumState]);

  // 晨昏线光照（夜半球阴影 + 橙黄虚线，等同 OL 2D 的晨昏线开关）
  useCesiumTerminator({
    viewerRef,
    cesiumState,
    showTerminator,
    terminatorShowDashed,
    liveMode,
    idx,
    gt,
  });

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
