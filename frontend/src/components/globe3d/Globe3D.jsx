// 3D 地球视图（CesiumJS，globe3d 子模块）：
//   - 地表星下点轨迹 + 真实空间轨道线（双线渲染）
//   - 地面站标记 + 0° 仰角通视圆（与 2D"可视范围"开关联动）
//   - 实时位置点（橙）/ 时间轴位置点（蓝），与 2D 完全同步
//   - 选中过境 AOS~LOS 高亮弧段
// 本组件负责 Viewer 生命周期（懒创建/相机/时钟/点击）与渲染效果编排；
// 坐标换算见 coords.js，Viewer/相机见 viewer.js，实体渲染见 render.js。
import React, { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { useSelector } from "react-redux";
import { Cesium, loadCesium } from "./cesiumGlobal.js";
import { createViewer, setBasemap, resetCamera, createInertialCameraUpdate } from "./viewer.js";
import { renderTrack, renderPasses, renderStationMarker, renderStationFootprint, renderRealPoint } from "./render.js";

export default function Globe3D({
  params, gt, passes, activePass, currentPos, idx,
  onSetIdx, visibleHours, showVisibility, active, passMode, liveMode,
  eci = false, onEciChange, cameraDistM = 20000000,
  basemap = "satellite", // 底图（Cesium key，与 2D/运行态势页共用，切换 2D/3D 保持一致）
  showLighting = true,  // 光照（昼夜明暗）：受工具栏"光照"开关控制，关闭则无昼夜阴影
}) {
  const { lat, lon, alt, satellite } = params;

  const containerRef = useRef(null);
  const viewerRef = useRef(null);          // Cesium Viewer
  const clickHandlerRef = useRef(null);    // 屏幕点击事件
  const createdRef = useRef(false);        // Viewer 是否已创建（懒加载）
  const resizeObserverRef = useRef(null);  // 容器尺寸监听
  // Cesium 懒加载状态：true=已就绪可创建 Viewer，string=加载失败原因
  const [cesiumState, setCesiumState] = useState("loading"); // "loading" | "ready" | error string

  const eciRef = useRef(false);            // 供回调读取的最新 eci 状态（由父级传入）
  eciRef.current = eci;

  // 单击地图联动开关（设置页"界面外观"）：默认关闭
  const clickEnabled = useSelector(
    (s) => (s.settings?.values?.map_click_link ?? false) === true
  );
  // gt / onSetIdx 经 ref 读取：点击 handler 空依赖创建，避免闭包过期
  const gtRef = useRef(gt);
  gtRef.current = gt;
  const onSetIdxRef = useRef(onSetIdx);
  onSetIdxRef.current = onSetIdx;

  // 各类实体的引用（轨迹/选中段/地面站/位置点）
  const trackEntitiesRef = useRef([]);     // 地表轨迹 + 空间轨道线
  const activeEntitiesRef = useRef([]);    // 选中过境高亮
  const stationEntityRef = useRef(null);
  const footprintEntityRef = useRef(null);
  const realPointRef = useRef(null);

  // 惯性视角下每帧保持相机位于惯性参考系：地球自转，轨道相对星空固定
  const onInertialUpdate = useCallback(createInertialCameraUpdate(eciRef), []);

  // 挂载后立即懒加载 Cesium（仅一次，复用 Promise），就绪后才允许创建 Viewer
  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then(() => {
        if (!cancelled) setCesiumState("ready");
      })
      .catch((e) => {
        if (!cancelled) setCesiumState(String((e && e.message) || e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 切换惯性/地图视角：惯性视角保持惯性相机（onInertialUpdate 让相机固定在星空背景，
  // 地球朝向由下方 clock-follow effect 按"显示时刻"推进）；地图视角为地球固连相机。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (eci) {
      viewer.scene.postUpdate.addEventListener(onInertialUpdate);
    } else {
      viewer.scene.postUpdate.removeEventListener(onInertialUpdate);
    }
  }, [eci, onInertialUpdate]);

  // 把场景时钟推进到当前"显示时刻"，使自转与光照/星空随时间正确呈现：
  //   - 实时模式 → 当前真实时刻（地球面向当前经度，太阳/光照对应现在）
  //   - 播放模式 → 时间轴当前点的时刻（地球自转到该时刻朝向，太阳/光照随之变化）
  // 惯性视角下地球朝向据此旋转；地球固连视角则太阳/星空/光照据此扫过静态地球。
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
    // 迫使重绘一帧，让太阳/星空/光照（及惯性视角的地球朝向）按新时刻更新
    viewer.scene.requestRender();
  }, [liveMode, currentPos, idx, gt, eci]);

  // 光照开关变化 → 即时启停昼夜阴影（与工具栏"光照"开关联动）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.globe.enableLighting = showLighting;
    viewer.scene.requestRender();
  }, [showLighting, cesiumState]);

  // 进入 3D（或切换 2D/3D 模式）时重置视角，使相机距离随模式自适应
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !active) return;
    resetCamera(viewer, lon, cameraDistM);
  }, [active, lon, cameraDistM]);

  // 首次进入 3D 视图时懒创建 Viewer（保证容器已有尺寸，且 Cesium 已就绪）
  useEffect(() => {
    if (!active || cesiumState !== "ready" || createdRef.current || !containerRef.current) return;
    const viewer = createViewer(containerRef.current);
    viewerRef.current = viewer;
    createdRef.current = true;
    // 光照（昼夜明暗）初始值：默认开启，受工具栏"光照"开关控制
    viewer.scene.globe.enableLighting = showLighting;

    // 超采样渲染：缓解 polyline 锯齿（提高分辨率换取线条平滑）
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);

    // 底图：按 basemap（Cesium key）切换（与 2D/运行态势共用同一套）
    setBasemap(viewer, basemap);

    // 容器尺寸变化（侧栏显隐 / 2D+3D 分栏 / 窗口缩放）时自动 resize
    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;

    // 初始视角：正顶视地面站，高度足够让整颗地球都可见
    resetCamera(viewer, lon, cameraDistM);

    return () => {
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      // viewer.destroy() 会统一销毁所有实体，无需单独 remove，避免访问已销毁的 entities
      viewer.destroy();
      viewerRef.current = null;
      createdRef.current = false;
      trackEntitiesRef.current = [];
      activeEntitiesRef.current = [];
      stationEntityRef.current = null;
      footprintEntityRef.current = null;
      realPointRef.current = null;
    };
    // gt 初始可能为空；仅依赖 active/cesiumState 触发创建
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

  // 从隐藏切回显示时刷新尺寸（both 模式下 3D 容器尺寸变化也需要重新计算）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !active) return;
    const timers = [0, 60, 120, 300].map((ms) => setTimeout(() => viewer.resize(), ms));
    return () => timers.forEach(clearTimeout);
  }, [active]);

  // 底图切换（与 2D 共用 mapStyle，切 2D/3D 保持一致）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || cesiumState !== "ready") return;
    setBasemap(viewer, basemap);
  }, [basemap, cesiumState]);

  // 地表轨迹 + 空间轨道线（随数据/显示时长重建）
  useEffect(() => {
    renderTrack({
      viewer: viewerRef.current,
      gt,
      visibleHours,
      eci,
      groupByOrbit: false, // 整段一条、统一单色：避免后端按「±180° 经度跳变」误增 orbit 号导致断裂/颜色跳变
      entitiesRef: trackEntitiesRef,
    });
  }, [gt, visibleHours, active, eci, cesiumState]);

  // 可见段 AOS~LOS 高亮 + 端点标注（支持 selected / all 两种模式）
  useEffect(() => {
    renderPasses({
      viewer: viewerRef.current,
      gt,
      passes,
      activePass,
      passMode,
      visibleHours,
      eci,
      entitiesRef: activeEntitiesRef,
    });
  }, [activePass, gt, passes, passMode, visibleHours, active, eci, cesiumState]);

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
    });
  }, [showVisibility, satellite, activePass, currentPos, gt, active, eci, cesiumState]);

  // 卫星位置点（统一单标记）：实时模式用 currentPos，播放模式用时间轴点；统一橙色
  useEffect(() => {
    renderRealPoint({
      viewer: viewerRef.current,
      gt,
      liveMode,
      currentPos,
      idx,
      eci,
      pointRef: realPointRef,
    });
  }, [liveMode, currentPos, idx, gt, active, eci, cesiumState]);

  // 注：不再在数据加载后自动 flyTo——此前误用卫星高度作相机高度导致视角过近，
  // 且会覆盖整球初始视角；需要近景时手动缩放即可。

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
    </Box>
  );
}
