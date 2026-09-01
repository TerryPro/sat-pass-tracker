// 卫星组 3D 运行状态页：选择一个数据源组，用 Cesium 在浏览器端展示该组全部卫星
// 的星下点分布 + 时间推进（SGP4 由 satellite.js 在本地计算，见 sat/satmath.mjs）。
// 渲染由 MultiGlobe 承担；数据装配在 useOrbitData，控制栏与面板均为独立子组件。
import React, { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import { useDispatch, useSelector } from "react-redux";
import { loadLibraryMeta } from "../slices/librarySlice.js";
import MultiGlobe from "../components/globe3d/MultiGlobe.jsx";
import { useOrbitData } from "./satellite3d/useOrbitData.js";
import SceneControls from "./satellite3d/SceneControls.jsx";
import SatListPanel from "./satellite3d/SatListPanel.jsx";
import SatInfoPanel from "./satellite3d/SatInfoPanel.jsx";

export default function Satellites3DPage() {
  const dispatch = useDispatch();
  const meta = useSelector((s) => s.library.meta);
  const [playedDate, setPlayedDate] = useState(() => new Date());
  const [selectedNorad, setSelectedNorad] = useState(null);
  // 卫星显示列表：右侧抽屉开关，控制哪些卫星不显示
  const [listOpen, setListOpen] = useState(false);
  // 选中星详情面板：右侧滑出；相机跟踪开关
  const [detailOpen, setDetailOpen] = useState(false);
  const [trackSat, setTrackSat] = useState(false);
  const [hiddenNorads, setHiddenNorads] = useState([]); // 被隐藏的 NORAD 列表
  // 轨道线显示控制：总开关 showOrbits + 逐颗关闭 orbitHiddenNorads
  const [showOrbits, setShowOrbits] = useState(true);
  const [orbitHiddenNorads, setOrbitHiddenNorads] = useState([]); // 不显示轨道线的卫星 NORAD 列表
  // 场景与底图设置（同卫星轨迹页 MapToolbar 风格，置于顶部控制栏）
  const [viewMode, setViewMode] = useState("3d");        // 3d|2d|columbus
  const [basemap, setBasemap] = useState("satellite");   // satellite|street|terrain|dark|nature|blackmarble|none
  const [skyOn, setSkyOn] = useState(true);
  const [hdr, setHdr] = useState(true);            // HDR 渲染（satvis 的 HDR）
  const [atmosphere, setAtmosphere] = useState(true); // 大气散射（satvis 的 Atmosphere）
  const [lighting, setLighting] = useState(true);     // 太阳光照与阴影（enableLighting）
  const [showNames, setShowNames] = useState(false);  // 3D 卫星点上是否显示名字标签
  const [frame, setFrame] = useState("fixed");           // 坐标系：fixed（地固）| inertial（惯性）
  // 界面时间显示时区（设置页配置）：utc | local
  const timeDisplay = useSelector((s) => s.settings.values?.time_display || "utc");
  // 轨道线颜色（设置页配置）
  const orbitColor = useSelector((s) => s.settings.values?.orbit_color) || "rgba(255,180,70,0.55)";
  // 3D 组件引用：播放/时间由 Cesium 自带控件驱动，这里仅用于「回到当前」设置时钟
  const globeRef = useRef(null);

  useEffect(() => {
    dispatch(loadLibraryMeta());
  }, [dispatch]);

  const downloadedGroups = useMemo(() => (meta?.groups || []).filter((g) => g.downloaded), [meta]);

  // 被隐藏卫星的集合（O(1) 判断）
  const hiddenSet = useMemo(() => new Set(hiddenNorads), [hiddenNorads]);
  // 不显示轨道线的卫星集合
  const orbitHiddenSet = useMemo(() => new Set(orbitHiddenNorads), [orbitHiddenNorads]);

  const {
    group, handleGroup: loadGroup,
    records, groupName, loading, error, setError,
    positions, orbits, getPositionsAt, maybeResample,
  } = useOrbitData({ downloadedGroups, hiddenSet, orbitHiddenSet, showOrbits, playedDate });

  // 换组：重置隐藏/轨道线逐颗开关，再加载数据
  const handleGroup = (key) => {
    setHiddenNorads([]);
    setOrbitHiddenNorads([]);
    loadGroup(key);
  };

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, height: "100%", minHeight: 0, overflow: "hidden" }}>
      <SceneControls
        group={group}
        downloadedGroups={downloadedGroups}
        onGroupChange={handleGroup}
        hasRecords={records.length > 0}
        onOpenList={() => setListOpen(true)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        frame={frame}
        onFrameChange={setFrame}
        basemap={basemap}
        onBasemapChange={setBasemap}
        skyOn={skyOn}
        onSkyOnChange={setSkyOn}
        hdr={hdr}
        onHdrChange={setHdr}
        atmosphere={atmosphere}
        onAtmosphereChange={setAtmosphere}
        lighting={lighting}
        onLightingChange={setLighting}
        showOrbits={showOrbits}
        onShowOrbitsChange={setShowOrbits}
        showNames={showNames}
        onShowNamesChange={setShowNames}
        selectedNorad={selectedNorad}
        onClearSelection={() => { setSelectedNorad(null); setDetailOpen(false); setTrackSat(false); }}
        onOpenDetail={() => setDetailOpen(true)}
      />

      {error && <Alert severity="error" size="small" onClose={() => setError("")}>{error}</Alert>}

      {/* 3D 地球：全组星下点 + 前 N 颗轨道线；未选组时仅显示地球与背景 */}
      <Paper sx={{ flex: 1, minHeight: 0, display: "flex", p: 0, position: "relative" }}>
        <MultiGlobe
          ref={globeRef}
          positions={positions}
          orbits={orbits}
          displayDate={playedDate}
          highlightNorad={selectedNorad}
          onPickNorad={(n) => {
            setSelectedNorad(n);
            setDetailOpen(n != null);
            setListOpen(false); // 打开详情时关闭卫星列表，避免面板叠放
          }}
          viewMode={viewMode}
          basemap={basemap}
          skyOn={skyOn}
          hdr={hdr}
          atmosphere={atmosphere}
          lighting={lighting}
          frame={frame}
          onTimeChange={(d) => {
            setPlayedDate((prev) => (prev.getTime() === d.getTime() ? prev : d));
            // 显示时刻每推进 1 小时 → 以该时刻重采样轨道缓存（体现 J2 进动）
            maybeResample(d);
          }}
          timeDisplay={timeDisplay}
          getPositionsAt={getPositionsAt}
          trackSat={trackSat}
          orbitColor={orbitColor}
          showNames={showNames}
          active
        />
        {loading && (
          <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "rgba(0,0,0,0.35)", color: "text.secondary", fontSize: 13 }}>
            加载组数据并计算星下点…
          </Box>
        )}
        {!loading && records.length === 0 && (
          <Box sx={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", px: 1.5, py: 0.5, borderRadius: "14px", bgcolor: "rgba(0,0,0,0.45)", color: "text.secondary", fontSize: 12, pointerEvents: "none" }}>
            请在上方选择一个数据源组，查看该组卫星的实时运行状态。
          </Box>
        )}

        {/* 卫星显示列表面板：定位在 3D 容器右侧、等高对齐（滑动开关控制每颗卫星是否显示） */}
        <SatListPanel
          open={listOpen}
          onClose={() => setListOpen(false)}
          groupName={groupName}
          records={records}
          hiddenSet={hiddenSet}
          orbitHiddenSet={orbitHiddenSet}
          selectedNorad={selectedNorad}
          onSelect={(norad) => { setSelectedNorad(norad); setDetailOpen(true); }}
          onToggleHidden={(norad) => {
            setHiddenNorads((prev) => (prev.includes(norad) ? prev.filter((n) => n !== norad) : [...prev, norad]));
          }}
          onToggleOrbitHidden={(norad) => {
            setOrbitHiddenNorads((prev) => (prev.includes(norad) ? prev.filter((n) => n !== norad) : [...prev, norad]));
          }}
          onSetHiddenNorads={setHiddenNorads}
        />

        {/* 选中星详情面板：左侧滑出，实时状态 + 轨道要素 + 相机跟踪（避免与右侧卫星列表重合） */}
        {/* bottom 让出 Cesium 左下角动画控件（Animation）与底部时间轴（Timeline）区域 */}
        <SatInfoPanel
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          records={records}
          selectedNorad={selectedNorad}
          playedDate={playedDate}
          timeDisplay={timeDisplay}
          trackSat={trackSat}
          onTrackChange={setTrackSat}
          frame={frame}
        />
      </Paper>
    </Box>
  );
}
