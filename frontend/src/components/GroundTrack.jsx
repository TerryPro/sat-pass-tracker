// 星下点轨道视图（主容器）：
//   - 数据加载/推演播放状态已拆到 hooks（useGroundData / usePlayback）
//   - 2D OpenLayers 地图已拆到 Map2D.jsx 子组件
//   - 3D 地球视图见 Globe3D.jsx；卡片头控制条/信息条/时间轴见 MapToolbar/InfoBar/TimelineBar
// 本组件保留：视图/显示状态（投影/经纬网/可视范围/显示模式/显示时长/晨昏线等）、
// 时间-仰角甘特图画布与交互，以及 2D/3D 视图容器布局。
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import { useSelector } from "react-redux";
import Map2D from "./Map2D.jsx";
import MapToolbar from "./MapToolbar.jsx";
import InfoBar from "./InfoBar.jsx";
import TimelineBar from "./TimelineBar.jsx";
import { useGroundData } from "../hooks/useGroundData.js";
import { usePlayback } from "../hooks/usePlayback.js";
import { useAppTheme } from "../hooks/useAppTheme.js";
import { useResizeRedraw } from "../hooks/useResizeRedraw.js";
import { ALL_HOURS } from "../constants.js";
import { drawGanttToCanvas } from "./gantt.js";

// 3D 视图懒加载：Cesium 体积大（~1MB），仅在切换到 3D / 2D+3D 时下载解析，
// 避免默认 2D 首屏也被迫加载 Cesium，明显加快首张地图出图。
const Globe3D = lazy(() => import("./globe3d/Globe3D.jsx"));
// Cesium 2D 引擎同样懒加载（仅当设置页选择 Cesium 引擎时才下载 Cesium）
const CesiumMap2D = lazy(() => import("./cesium2d/CesiumMap2D.jsx"));

// 各引擎的合法底图 key（与 MapToolbar.BASEMAP_OPTIONS 对应）
const OL_BASEMAPS = ["dark", "light", "satellite", "terrain", "standard"];
const CESIUM_BASEMAPS = ["satellite", "street", "terrain", "dark", "nature", "blackmarble", "none"];
// OL 底图 key → Cesium key（引擎切换或传给 Globe3D/CesiumMap2D 时使用）
const OL_TO_CESIUM_BASEMAP = {
  dark: "dark",
  light: "light",
  satellite: "satellite",
  terrain: "terrain",
  standard: "street",
};

export default function GroundTrack({ params, passes, activeIdx, onSelect, activePass, currentPos, sidebarVisible }) {
  const { lat, lon, alt, hours, satellite } = params;

  // 数据加载（gt/loading/error）；加载成功后重置时间轴索引到起点
  const { gt, loading, error } = useGroundData(
    { lat, lon, alt, hours, satellite },
    { onLoaded: () => setIdx(0) }
  );
  // 推演/播放状态（idx/playing/liveMode/playRate + 播放推进 + 过境联动）
  const { idx, setIdx, playing, setPlaying, liveMode, setLiveMode, playRate, setPlayRate } =
    usePlayback({ gt, passes, activeIdx, onSelect });

  // 视图/显示状态
  const [proj, setProj] = useState("EPSG:4326"); // 地图投影（EPSG:3857 / EPSG:4326）
  const [showGrid, setShowGrid] = useState(false); // 是否显示经纬网与经纬度标签
  const [showVisibility, setShowVisibility] = useState(false); // 是否显示地面站可视范围
  const [passMode, setPassMode] = useState("selected"); // 可见段显示模式：selected / all
  const [mapStyle, setMapStyle] = useState("satellite"); // 底图样式
  const [visibleHours, setVisibleHours] = useState(ALL_HOURS); // 星下点轨迹显示窗口（-1=全部，跟随计算窗口）
  const [viewMode, setViewMode] = useState("2d"); // 地图视图：2d / 3d / both（2D+3D 同时显示）
  const [eci3d, setEci3d] = useState(false); // 3D 参考系：false=地固系（ECEF），true=惯性系（ICRF）
  const [showTerminator, setShowTerminator] = useState(true); // 是否显示晨昏线
  // 应用主题（设置页 theme 字段）：甘特图画布配色按主题取色
  const theme = useAppTheme();
  const ganttRef = useRef(null); // 时间-仰角甘特图 canvas
  // 2D 地图引擎（设置页「计算」组配置）：ol（OpenLayers，默认）| cesium（Cesium 2D 对照测试）
  const map2dEngine = useSelector((s) => s.settings.values?.map2d_engine || "ol");
  const cesium2d = map2dEngine === "cesium";
  // 2D/3D 实际使用的 Cesium 底图 key：Cesium 引擎下 mapStyle 即 key；OL 引擎下映射
  const cesiumBasemap = cesium2d ? mapStyle : (OL_TO_CESIUM_BASEMAP[mapStyle] || "satellite");

  // 引擎切换：底图 key 不在目标引擎合法列表时，规整为两引擎共有的 satellite，
  // 避免下拉空选 / 引擎拿到非法 key（例如 OL 的 light ↔ Cesium 的 street/nature）
  useEffect(() => {
    const legal = cesium2d ? CESIUM_BASEMAPS : OL_BASEMAPS;
    if (!legal.includes(mapStyle)) setMapStyle("satellite");
  }, [cesium2d]); // eslint-disable-line react-hooks/exhaustive-deps

  // 显示时长的实际生效值：-1（全部）时跟随计算窗口 hours，
  // 保证轨迹渲染/甘特图/推演始终覆盖完整计算时长（切到 72h/168h 后自动全窗口）。
  const effVisibleHours = visibleHours === ALL_HOURS ? hours || 48 : visibleHours;

  // 时间-仰角甘特图绘制：见 gantt.js（drawGanttToCanvas）
  const drawGantt = () =>
    drawGanttToCanvas({
      canvas: ganttRef.current,
      gt,
      passes,
      activeIdx,
      idx,
      visibleHours: effVisibleHours,
    });

  // 甘特图重绘：数据/选中/索引/显示时长/主题变化时
  useEffect(() => {
    drawGantt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gt, passes, activeIdx, idx, visibleHours, theme]);

  // 窗口尺寸 / 侧栏折叠变化 → 重绘甘特图（地图 fit 由 Map2D 内部处理）
  useResizeRedraw(drawGantt, [sidebarVisible]);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 1.25,
      }}
    >
      <MapToolbar
        viewMode={viewMode}
        onViewMode={setViewMode}
        eci3d={eci3d}
        onEci={setEci3d}
        visibleHours={visibleHours}
        onVisibleHours={setVisibleHours}
        hours={hours}
        mapStyle={mapStyle}
        onMapStyle={setMapStyle}
        basemapEngine={cesium2d ? "cesium" : "ol"}
        proj={proj}
        onProj={setProj}
        showProj={!cesium2d}
        showGrid={showGrid}
        onShowGrid={setShowGrid}
        showTerminator={showTerminator}
        onShowTerminator={setShowTerminator}
        showVisibility={showVisibility}
        onShowVisibility={setShowVisibility}
        passMode={passMode}
        onPassMode={setPassMode}
      />
      {/* 视图容器：2D/3D 切换时保持挂载；both 模式下左右分栏同时显示 */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: viewMode === "both" ? "row" : "column",
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            flex: viewMode === "both" ? "3 1 0" : 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            ...(viewMode === "3d" ? { display: "none" } : {}),
          }}
        >
          {cesium2d ? (
            // Cesium 2D 引擎（懒加载，仅下载 Cesium chunk 时显示 fallback）
            <Suspense
              fallback={
                <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "text.secondary", fontSize: 13 }}>
                  加载 2D 视图（Cesium）…
                </Box>
              }
            >
              <CesiumMap2D
                params={params}
                gt={gt}
                passes={passes}
                activeIdx={activeIdx}
                onSelect={onSelect}
                activePass={activePass}
                currentPos={currentPos}
                idx={idx}
                liveMode={liveMode}
                proj={proj}
                showGrid={showGrid}
                showVisibility={showVisibility}
                passMode={passMode}
                mapStyle={mapStyle}
                visibleHours={effVisibleHours}
                showTerminator={showTerminator}
                active={viewMode !== "3d"}
                sidebarVisible={sidebarVisible}
                onSetIdx={(i) => { setIdx(i); setLiveMode(false); }}
              />
            </Suspense>
          ) : (
            <Map2D
              params={params}
              gt={gt}
              passes={passes}
              activeIdx={activeIdx}
              onSelect={onSelect}
              activePass={activePass}
              currentPos={currentPos}
              idx={idx}
              liveMode={liveMode}
              proj={proj}
              showGrid={showGrid}
              showVisibility={showVisibility}
              passMode={passMode}
              mapStyle={mapStyle}
              visibleHours={effVisibleHours}
              showTerminator={showTerminator}
              active={viewMode !== "3d"}
              sidebarVisible={sidebarVisible}
            />
          )}
        </Box>
        <Box
          sx={{
            flex: viewMode === "both" ? "2 1 0" : 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            ...(viewMode === "2d" ? { display: "none" } : {}),
          }}
        >
          {/* 仅在 3D / 2D+3D 时挂载 Globe3D（懒加载），2D 模式完全不加载 Cesium chunk */}
          {viewMode === "2d" ? null : (
            <Suspense
              fallback={
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "text.secondary",
                    fontSize: 13,
                  }}
                >
                  加载 3D 视图…
                </Box>
              }
            >
              <Globe3D
                params={params}
                gt={gt}
                passes={passes}
                activePass={activePass}
                currentPos={currentPos}
                idx={idx}
                onSetIdx={(i) => { setIdx(i); setLiveMode(false); }}
                visibleHours={effVisibleHours}
                showVisibility={showVisibility}
                active={viewMode === "3d" || viewMode === "both"}
                passMode={passMode}
                liveMode={liveMode}
                eci={eci3d}
                onEciChange={setEci3d}
                basemap={cesiumBasemap} // 与 2D 共用同一底图，切 2D/3D 保持一致
                cameraDistM={viewMode === "both" ? 12000000 : 20000000}
              />
            </Suspense>
          )}
        </Box>
      </Box>
      {loading && <Box sx={{ p: 3, textAlign: "center", color: "text.secondary", fontSize: 13 }}>加载星下点轨迹…</Box>}
      {error && <Box sx={{ p: 3, textAlign: "center", color: "#f87171", fontSize: 13 }}>加载失败：{error}</Box>}
      {gt && (
        <>
          <InfoBar activePass={activePass} liveMode={liveMode} currentPos={currentPos} gt={gt} idx={idx} />
          <Box
            component="canvas"
            ref={ganttRef}
            sx={{
              width: "100%",
              height: 110,
              mt: 1.25,
              borderRadius: "8px",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "var(--canvas-bg)",
              cursor: "crosshair",
            }}
            onClick={(e) => {
              const canvas = ganttRef.current;
              if (!canvas || !gt) return;
              const rect = canvas.getBoundingClientRect();
              const padL = 36, padR = 10;
              const plotW = rect.width - padL - padR;
              const startT = new Date(gt.points[0].t).getTime();
              const endT = Math.min(
                new Date(gt.points[gt.points.length - 1].t).getTime(),
                startT + effVisibleHours * 3600 * 1000
              );
              const x = e.clientX - rect.left;
              const ratio = Math.max(0, Math.min(1, (x - padL) / plotW));
              const targetT = startT + ratio * (endT - startT);
              // 点击时选择最近的过境
              if (passes && passes.length) {
                let best = activeIdx || 0;
                let bestD = Infinity;
                passes.forEach((p, i) => {
                  const mid = (new Date(p.aos).getTime() + new Date(p.los).getTime()) / 2;
                  const d = Math.abs(mid - targetT);
                  if (d < bestD) { bestD = d; best = i; }
                });
                onSelect(best);
              }
              // 同步时间轴索引到该时间点
              let bestIdx = 0;
              let bestD = Infinity;
              gt.points.forEach((p, i) => {
                const d = Math.abs(new Date(p.t).getTime() - targetT);
                if (d < bestD) { bestD = d; bestIdx = i; }
              });
              setIdx(bestIdx);
              setPlaying(false);
              setLiveMode(false);
            }}
          />
          <TimelineBar
            liveMode={liveMode}
            onLiveMode={setLiveMode}
            playing={playing}
            onSetPlaying={setPlaying}
            idx={idx}
            onIdx={setIdx}
            gt={gt}
            visibleHours={effVisibleHours}
            playRate={playRate}
            onPlayRate={setPlayRate}
          />
        </>
      )}
    </Paper>
  );
}
