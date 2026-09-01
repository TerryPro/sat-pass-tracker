// 2D 星下点地图（OpenLayers 子模块）：从 GroundTrack 中拆出。
// 负责世界地图初始化、图层管理与全部 2D 渲染逻辑：
//   - 完整轨迹（按圈拆分、±180° 封口）+ 选中过境可见段高亮（AOS/LOS 标注）
//   - 卫星实时/时间轴位置点 + 覆盖圆，地面站标记 + 可视范围
//   - 经纬网/经纬度标注、晨昏线（夜半球阴影 + 橙黄虚线）
//   - 底图样式切换、投影（EPSG:4326/3857）切换、点击轨迹点查询
// 地图实例与所有图层逻辑均拆分为 hooks（components/map2d/），本组件只做装配。
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { useSelector } from "react-redux";
import { useAppTheme } from "../hooks/useAppTheme.js";
import { useMapInit } from "./map2d/useMapInit.js";
import { useGridLayer } from "./map2d/useGridLayer.js";
import { useTerminatorLayer } from "./map2d/useTerminatorLayer.js";
import { useTrackLayer } from "./map2d/useTrackLayer.js";
import { useVisiblePasses } from "./map2d/useVisiblePasses.js";
import { useStationLayers } from "./map2d/useStationLayers.js";
import { useSatelliteLayers } from "./map2d/useSatelliteLayers.js";

export default function Map2D({
  params,
  gt,
  passes,
  activeIdx,
  onSelect,
  activePass,
  currentPos,
  idx,
  liveMode,
  proj,
  showGrid,
  showVisibility,
  passMode,
  mapStyle,
  visibleHours,
  showTerminator,
  active, // 2D 容器是否可见（viewMode !== "3d"），用于容器尺寸恢复后刷新
  sidebarVisible,
}) {
  const { lat, lon, alt, satellite } = params;

  const mapRef = useRef(null);          // 地图挂载点
  const mapObjRef = useRef(null);       // OpenLayers Map 实例
  const gtRef = useRef(null);           // 最新星下点数据（供点击回调读取）
  const projRef = useRef("EPSG:4326");  // 当前投影（供点击回调读取）

  const [hover, setHover] = useState(null); // 当前展示/查询的数据点（仅本组件内部交互使用）

  // 晨昏线橘色虚线开关：来自用户持久化设置（设置页外观卡片中配置）
  const terminatorShowDashed = useSelector(
    (s) => (s.settings?.values?.terminator_show_dashed ?? true) === true
  );
  // 应用主题（设置页 theme 字段）：驱动线条/标签/标记配色与容器底色
  const theme = useAppTheme();

  projRef.current = proj;
  // 同步最新 gt 到 ref：地图点击等空依赖回调需要读取最新数据，避免闭包过期
  useEffect(() => {
    gtRef.current = gt;
  }, [gt]);
  // 数据刷新后清空查询点（对应原 GroundTrack 数据加载成功后的 setHover(null)）
  useEffect(() => {
    setHover(null);
  }, [gt]);

  // 主题切换：地图样式函数（轨迹线）按主题取色需主动重渲染（经纬网重绘见 useGridLayer）
  useEffect(() => {
    const map = mapObjRef.current;
    if (map) map.render();
  }, [theme]);

  const {
    trackSourceRef, visibleSourceRef, stationSourceRef, posSourceRef,
    gridSourceRef, footprintSourceRef, stationFootprintSourceRef, terminatorSourceRef,
  } = useMapInit({
    mapRef, mapObjRef, gtRef, projRef,
    mapStyle, proj, active, sidebarVisible, onHover: setHover,
  });

  useGridLayer({ mapObjRef, gridSourceRef, proj, showGrid, theme });
  useTerminatorLayer({
    mapObjRef, terminatorSourceRef,
    showTerminator, liveMode, idx, gt, proj, terminatorShowDashed,
  });
  useTrackLayer({ mapObjRef, trackSourceRef, gt, proj, visibleHours });
  useVisiblePasses({
    mapObjRef, visibleSourceRef,
    gt, passes, activePass, passMode, visibleHours, proj, theme,
  });
  useStationLayers({
    mapObjRef, stationSourceRef, stationFootprintSourceRef,
    lat, lon, alt, proj, theme, showVisibility,
    currentPos, satellite, activePass, gt,
  });
  useSatelliteLayers({
    mapObjRef, posSourceRef, footprintSourceRef,
    liveMode, currentPos, idx, gt, proj, theme, alt, onHover: setHover,
  });

  return (
    <Box
      ref={mapRef}
      sx={{
        flex: 1,
        width: "100%",
        minHeight: 0,
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        // 底图瓦片未覆盖区域（如高纬空白处）：暗色底图深色、亮色底图浅色
        bgcolor: theme === "dark" ? "#10151f" : "#e8eaee",
      }}
    />
  );
}
