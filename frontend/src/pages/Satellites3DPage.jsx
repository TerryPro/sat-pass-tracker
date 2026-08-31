// 卫星组 3D 运行状态页：选择一个数据源组，用 Cesium 在浏览器端展示该组全部卫星
// 的星下点分布 + 时间推进（SGP4 由 satellite.js 在本地计算，见 sat/satmath.mjs）。
// 复用 globe3d 的 viewer 工厂与 Cesium 懒加载；渲染由 MultiGlobe 承担。
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Slide from "@mui/material/Slide";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import ListAltIcon from "@mui/icons-material/ListAlt";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";
import { useDispatch, useSelector } from "react-redux";
import { loadLibraryMeta } from "../slices/librarySlice.js";
import { fetchLibraryEntries } from "../api/library.js";
import { buildSatRecords, buildOrbitCache, interpEciAtMs, subpoint, MAX_ALL_PINS, orbitElements, speedAt } from "../sat/satmath.mjs";
import MultiGlobe from "../components/globe3d/MultiGlobe.jsx";

const MAX_ORBIT = 800;        // 最多给前 N 颗星画轨道线（轨道缓存上限 MAX_ALL_PINS=800，二者对齐）

// 显示时刻格式化：utc → UTC 时间；local → 本地时间
function fmtHMS(date, mode = "utc") {
  const p = (n) => String(n).padStart(2, "0");
  if (mode === "local") {
    return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())} 本地`;
  }
  return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} UTC`;
}

// 详情面板行：label + value 两端对齐
function InfoRow({ label, value }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, minWidth: 0 }}>
      <Box component="span" sx={{ color: "text.secondary", flexShrink: 0 }}>{label}</Box>
      <Box component="span" sx={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value ?? "—"}</Box>
    </Box>
  );
}

export default function Satellites3DPage() {
  const dispatch = useDispatch();
  const meta = useSelector((s) => s.library.meta);
  const [group, setGroup] = useState("");
  const [records, setRecords] = useState([]);       // [{norad,name,satrec}]
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playedDate, setPlayedDate] = useState(() => new Date());
  const [selectedNorad, setSelectedNorad] = useState(null);
  // 卫星显示列表：右侧抽屉开关，控制哪些卫星不显示
  const [listOpen, setListOpen] = useState(false);
  const [listKw, setListKw] = useState("");
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

  // 轨道采样缓存（选组时一次性预计算；播放/拖动时用插值取位，避免每帧全组 SGP4）
  const [orbitCache, setOrbitCache] = useState([]);

  // 被隐藏卫星的集合（O(1) 判断）
  const hiddenSet = useMemo(() => new Set(hiddenNorads), [hiddenNorads]);
  // 不显示轨道线的卫星集合
  const orbitHiddenSet = useMemo(() => new Set(orbitHiddenNorads), [orbitHiddenNorads]);

  // 播放时按「显示时刻」对缓存插值得到全组 ECI 位置（纯插值，无 SGP4 重算），剔除被隐藏的卫星
  const positions = useMemo(() => {
    if (!orbitCache.length || !playedDate) return [];
    const ms = playedDate.getTime();
    return orbitCache.filter((c) => !hiddenSet.has(c.norad)).map((c) => ({
      norad: c.norad,
      name: c.name,
      eci: interpEciAtMs(c, ms),
      isValid: true,
    }));
  }, [orbitCache, playedDate, hiddenSet]);

  // 供 MultiGlobe 每帧同步卫星点位置：按「最新时钟时刻」插值全组（与轨道线同帧同时刻，
  // 避免高倍速下 React 状态滞后导致卫星脱轨），同样剔除被隐藏的卫星
  const getPositionsAt = useCallback((d) => {
    if (!orbitCache.length || !d) return [];
    const ms = d.getTime();
    return orbitCache.filter((c) => !hiddenSet.has(c.norad)).map((c) => ({
      norad: c.norad,
      name: c.name,
      eci: interpEciAtMs(c, ms),
      isValid: true,
    }));
  }, [orbitCache, hiddenSet]);

  // 轨道线数据（从采样缓存取 ECI 序列）：卫星本身显示、且轨道线开关开启（总开关 && 未被逐颗关闭）的才画。
  // 携带轨道缓存 cache：地固系下用「当前时刻 + 采样偏移」插值取 ECI 并实时转换，
  // 轨道线始终经过卫星当前位置、随时间动态更新；GEO（同步）自然收缩为静止点
  const orbits = useMemo(
    () =>
      orbitCache
        .filter((c) => !hiddenSet.has(c.norad))
        .filter((c) => showOrbits && !orbitHiddenSet.has(c.norad))
        .slice(0, MAX_ORBIT)
        .map((c) => ({
          norad: c.norad,
          name: c.name,
          cache: c, // 整圈轨道缓存：绘制统一按「当前时刻 + 采样偏移」插值，仅坐标系决定转换时刻
        })),
    [orbitCache, hiddenSet, orbitHiddenSet, showOrbits]
  );

  // 载入选中的组
  const handleGroup = async (key) => {
    const g = downloadedGroups.find((x) => x.key === key);
    setGroup(key);
    setError("");
    setLoading(true);
    try {
      const res = await fetchLibraryEntries({ source: key });
      const r = buildSatRecords(res.entries || []);
      if (!r.length) { setError("该组没有可解析的卫星 TLE"); return; }
      setRecords(r);
      setGroupName(g ? g.label : key);
      const now = new Date();
      setPlayedDate(now);
      lastResampleMsRef.current = now.getTime(); // 重置重采样基准（选组已按当前时刻采样）
      globeRef.current?.setTime(now); // 同步 Cesium 时钟到当前时刻
      // 一次性预采样全组轨道（含周期），播放/拖动时用插值取位，显著减少每帧 SGP4
      const cache = buildOrbitCache(r, now, 60);
      setOrbitCache(cache);
      setHiddenNorads([]); // 换组时重置隐藏选择
      setOrbitHiddenNorads([]); // 换组时重置轨道线逐颗开关
      setListKw("");
    } catch (e) {
      setError(e.message || "加载组数据失败");
    } finally {
      setLoading(false);
    }
  };

  // 定期（60s）用「当前时刻」重采样轨道缓存：使轨道线/卫星点体现 J2 轨道面进动，
  // 而非停留在选组时刻的瞬时轨道。分片（每帧 40 颗）避免一次性阻塞主线程。
  // 重采样只替换数据（norad 集合不变），MultiGlobe 轨道线经 ref 读取，不触发实体重建。
  // 注意：重采样基准必须是「显示时刻」（clock.currentTime）而非真实时间——
  // 播放时显示时刻快速推进，进动按显示时刻累积，用真实时间重采样轨道面几乎不动。
  const lastResampleMsRef = useRef(0);
  const resampleBusyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const startResample = useCallback((t) => {
    if (resampleBusyRef.current || !aliveRef.current) return;
    resampleBusyRef.current = true;
    const list = records.filter((r) => !hiddenSet.has(r.norad)).slice(0, MAX_ALL_PINS);
    const all = [];
    let i = 0;
    const step = () => {
      if (!aliveRef.current) return;
      const batch = list.slice(i, i + 40);
      i += 40;
      for (const r of batch) {
        const c = buildOrbitCache([r], t, 60, 1)[0];
        if (c) all.push(c);
      }
      if (i < list.length) {
        requestAnimationFrame(step);
      } else {
        resampleBusyRef.current = false;
        if (all.length) {
          setOrbitCache((prev) => {
            const m = new Map(prev.map((x) => [x.norad, x]));
            all.forEach((c) => m.set(c.norad, c));
            return [...m.values()];
          });
        }
      }
    };
    step();
  }, [records, hiddenSet]);

  // 选中星详情：实时位置/高度/速度 + 轨道要素（随播放时刻实时更新）
  const selectedDetail = useMemo(() => {
    if (selectedNorad == null) return null;
    const s = records.find((x) => x.norad === selectedNorad);
    if (!s) return null;
    const p = subpoint(s, playedDate);
    const speed = speedAt(s.satrec, playedDate);
    const el = orbitElements(s.satrec);
    return {
      name: s.name,
      norad: s.norad,
      valid: !!(p && p.isValid),
      lat: p ? p.lat : NaN,
      lon: p ? p.lon : NaN,
      altKm: p ? p.altKm : NaN,
      speedKmS: speed,
      ...el,
    };
  }, [selectedNorad, records, playedDate]);

  // 卫星显示列表：开关某颗卫星的显示/隐藏
  const toggleHidden = (norad) => {
    setHiddenNorads((prev) => (prev.includes(norad) ? prev.filter((n) => n !== norad) : [...prev, norad]));
  };
  // 卫星显示列表：开关某颗卫星的轨道线显示/隐藏
  const toggleOrbitHidden = (norad) => {
    setOrbitHiddenNorads((prev) => (prev.includes(norad) ? prev.filter((n) => n !== norad) : [...prev, norad]));
  };
  // 列表搜索过滤（按名称或 NORAD 编号）
  const filtered = useMemo(() => {
    const kw = listKw.trim().toLowerCase();
    if (!kw) return records;
    return records.filter((r) => r.name.toLowerCase().includes(kw) || String(r.norad).includes(kw));
  }, [records, listKw]);

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* 顶部控制栏 */}
      <Paper sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flexShrink: 0 }}>
        <Select
          size="small"
          displayEmpty
          value={group}
          onChange={(e) => handleGroup(e.target.value)}
          sx={{ minWidth: 200 }}
          renderValue={(v) => {
            if (!v) return <Typography variant="body2" color="text.secondary">选择数据源组…</Typography>;
            const g = downloadedGroups.find((x) => x.key === v);
            return g ? g.label : v;
          }}
        >
          {downloadedGroups.length === 0 && <MenuItem value="" disabled>暂无已下载的组</MenuItem>}
          {downloadedGroups.map((g) => (
            <MenuItem key={g.key} value={g.key}>{g.label}（{g.count}）</MenuItem>
          ))}
        </Select>

        {records.length > 0 && (
          <IconButton size="small" title="卫星显示列表" onClick={() => setListOpen(true)}>
            <ListAltIcon fontSize="small" />
          </IconButton>
        )}

        {/* 场景与底图设置：视图切换 / 坐标系 / 底图 / 星空（未选组也可见，地球与背景默认即显示） */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_, v) => v && setViewMode(v)}
            title="切换 3D 球体 / 2D 平面 / 哥伦布展开视图"
          >
            <ToggleButton value="3d">3D</ToggleButton>
            <ToggleButton value="2d">2D</ToggleButton>
            <ToggleButton value="columbus">展开</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={frame}
            onChange={(_, v) => v && setFrame(v)}
            title="坐标系：地固（地球固定、卫星相对地表运动）或惯性（轨道相对星空固定、地球自转，仅 3D 生效）"
          >
            <ToggleButton value="fixed">地固</ToggleButton>
            <ToggleButton value="inertial">惯性</ToggleButton>
          </ToggleButtonGroup>
          <FormControl size="small" title="3D 地球底图">
            <InputLabel>底图</InputLabel>
            <Select
              value={basemap}
              label="底图"
              sx={{ minWidth: 96 }}
              onChange={(e) => setBasemap(e.target.value)}
            >
              <MenuItem value="satellite">卫星</MenuItem>
              <MenuItem value="street">街道</MenuItem>
              <MenuItem value="terrain">地形</MenuItem>
              <MenuItem value="dark">暗色</MenuItem>
              <MenuItem value="nature">自然</MenuItem>
              <MenuItem value="blackmarble">夜光</MenuItem>
              <MenuItem value="none">无</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel
            control={<Switch size="small" checked={skyOn} onChange={(e) => setSkyOn(e.target.checked)} />}
            label="星空"
            title="显示天球星空与大气"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={hdr} onChange={(e) => setHdr(e.target.checked)} />}
            label="HDR"
            title="高动态范围渲染：亮部不过曝、暗部保留细节"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={atmosphere} onChange={(e) => setAtmosphere(e.target.checked)} />}
            label="大气"
            title="地球边缘的大气散射光晕"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={lighting} onChange={(e) => setLighting(e.target.checked)} />}
            label="光照"
            title="太阳光照产生的明暗与阴影（晨昏线）"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={showOrbits} onChange={(e) => setShowOrbits(e.target.checked)} />}
            label="轨道线"
            title="总开关：显示/隐藏所有卫星轨道线（可在卫星列表逐颗控制）"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />}
            label="名字"
            title="在 3D 卫星点上显示/隐藏卫星名字标签"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
          />
        </Box>

        {/* 选中/跟踪卫星：信息面板图标按钮（醒目色）+ 取消跟踪（红底白字），整体靠右 */}
        {selectedNorad != null && (
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <IconButton size="small" color="warning" title="卫星信息面板" onClick={() => setDetailOpen(true)}>
              <SatelliteAltIcon fontSize="small" />
            </IconButton>
            <Button size="small" color="error" variant="contained" startIcon={<CloseIcon fontSize="small" />} onClick={() => { setSelectedNorad(null); setDetailOpen(false); setTrackSat(false); }}>
              取消跟踪
            </Button>
          </Box>
        )}
      </Paper>

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
            // 显示时刻每推进 1 小时 → 以该时刻重采样轨道缓存（体现 J2 进动）。
            // 用显示时刻而非真实时间：播放时显示时刻快速推进，进动按显示时刻累积。
            const RESAMPLE_STEP_MS = 3600000;
            if (records.length && d.getTime() - lastResampleMsRef.current >= RESAMPLE_STEP_MS) {
              lastResampleMsRef.current = d.getTime();
              startResample(d);
            }
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
        <Slide direction="left" in={listOpen} mountOnEnter unmountOnExit>
          <Box sx={{ position: "absolute", top: 0, right: 0, bottom: 120, width: 380, maxWidth: "88%", bgcolor: "background.paper", borderLeft: "1px solid", borderColor: "divider", boxShadow: "-8px 0 24px rgba(0,0,0,0.3)", zIndex: 3, display: "flex", flexDirection: "column" }}>
            <Box sx={{ p: 1.25, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={groupName}>
                {groupName ? `${groupName} · 卫星列表` : "卫星显示列表"}
              </Typography>
              <Button size="small" onClick={() => setHiddenNorads([])}>全显</Button>
              <Button size="small" onClick={() => setHiddenNorads(records.map((r) => r.norad))}>全隐</Button>
              <IconButton size="small" onClick={() => setListOpen(false)}><CloseIcon fontSize="small" /></IconButton>
            </Box>
            <Box sx={{ p: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
              <TextField size="small" fullWidth placeholder="搜索名称 / NORAD" value={listKw} onChange={(e) => setListKw(e.target.value)} />
            </Box>
            {/* 列头：说明两个开关列含义（与行内 flex 布局对齐） */}
            <Box sx={{ px: 1.25, py: 0.5, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1, fontSize: 11, color: "text.secondary" }}>
              <Box sx={{ flex: "1 1 auto" }}>卫星名称</Box>
              <Box sx={{ flexShrink: 0, width: 42, textAlign: "center" }} title="是否绘制该卫星的轨道线">轨道线</Box>
              <Box sx={{ flexShrink: 0, width: 42, textAlign: "center" }} title="是否显示该卫星">显示</Box>
            </Box>
            <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <List dense disablePadding>
                {filtered.map((r) => (
                  <ListItem
                    key={r.norad}
                    disableGutters
                    sx={{
                      px: 1.25,
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.hover" },
                      ...(selectedNorad === r.norad && {
                        bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(59,130,246,0.28)" : "rgba(59,130,246,0.14)"),
                        "& .MuiListItemText-primary": { color: "primary.main", fontWeight: 600 },
                      }),
                    }}
                    title="双击选中（跟踪）该卫星"
                    onDoubleClick={() => { setSelectedNorad(r.norad); setDetailOpen(true); }}
                  >
                    <ListItemText
                      sx={{ minWidth: 0, flex: "1 1 auto" }}
                      primary={
                        <Box title={r.name} sx={{ fontSize: 13, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.name}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ fontSize: 11, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          NORAD {r.norad}
                        </Box>
                      }
                    />
                    <Switch size="small" title="显示该卫星轨道线" sx={{ flexShrink: 0, width: 42 }} checked={!orbitHiddenSet.has(r.norad)} onChange={() => toggleOrbitHidden(r.norad)} />
                    <Switch size="small" title="显示该卫星" sx={{ flexShrink: 0, width: 42 }} checked={!hiddenSet.has(r.norad)} onChange={() => toggleHidden(r.norad)} />
                  </ListItem>
                ))}
                {!filtered.length && (
                  <ListItem><Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>无匹配卫星</Typography></ListItem>
                )}
              </List>
            </Box>
            <Box sx={{ p: 1, borderTop: "1px solid", borderColor: "divider", fontSize: 12, color: "text.secondary" }}>
              共 {records.length} 颗 · 显示 {records.length - hiddenNorads.length} 颗 · 隐藏 {hiddenNorads.length} 颗
            </Box>
          </Box>
        </Slide>

        {/* 选中星详情面板：左侧滑出，实时状态 + 轨道要素 + 相机跟踪（避免与右侧卫星列表重合） */}
        {/* bottom 让出 Cesium 左下角动画控件（Animation）与底部时间轴（Timeline）区域 */}
        <Slide direction="right" in={detailOpen && !!selectedDetail} mountOnEnter unmountOnExit>
          <Box sx={{ position: "absolute", top: 0, left: 0, bottom: 120, width: 340, maxWidth: "88%", bgcolor: "background.paper", borderRight: "1px solid", borderColor: "divider", boxShadow: "8px 0 24px rgba(0,0,0,0.3)", zIndex: 4, display: "flex", flexDirection: "column" }}>
            {/* 头部 */}
            <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={selectedDetail?.name}>
                  {selectedDetail?.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>NORAD {selectedDetail?.norad}</Typography>
              </Box>
              <IconButton size="small" title="关闭" onClick={() => setDetailOpen(false)}><CloseIcon fontSize="small" /></IconButton>
            </Box>
            {/* 实时状态 */}
            <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
              <Typography variant="caption" color="text.secondary">实时状态（{fmtHMS(playedDate, timeDisplay)}）</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", mt: 0.75, fontSize: 13 }}>
                <InfoRow label="纬度" value={selectedDetail?.valid ? `${selectedDetail.lat.toFixed(2)}°` : "—"} />
                <InfoRow label="经度" value={selectedDetail?.valid ? `${selectedDetail.lon.toFixed(2)}°` : "—"} />
                <InfoRow label="高度" value={selectedDetail?.valid ? `${Math.round(selectedDetail.altKm)} km` : "—"} />
                <InfoRow label="速度" value={selectedDetail?.speedKmS != null ? `${selectedDetail.speedKmS.toFixed(2)} km/s` : "—"} />
              </Box>
            </Box>
            {/* 轨道要素 */}
            <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
              <Typography variant="caption" color="text.secondary">轨道要素</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", mt: 0.75, fontSize: 13 }}>
                <InfoRow label="倾角" value={selectedDetail ? `${selectedDetail.inclDeg.toFixed(2)}°` : "—"} />
                <InfoRow label="升交点赤经" value={selectedDetail ? `${selectedDetail.raanDeg.toFixed(2)}°` : "—"} />
                <InfoRow label="近地点幅角" value={selectedDetail ? `${selectedDetail.argpDeg.toFixed(2)}°` : "—"} />
                <InfoRow label="偏心率" value={selectedDetail ? selectedDetail.ecc.toFixed(5) : "—"} />
                <InfoRow label="轨道周期" value={selectedDetail ? `${selectedDetail.periodMin.toFixed(1)} min` : "—"} />
                <InfoRow label="近地点" value={selectedDetail ? `${Math.round(selectedDetail.perigeeKm)} km` : "—"} />
                <InfoRow label="远地点" value={selectedDetail ? `${Math.round(selectedDetail.apogeeKm)} km` : "—"} />
              </Box>
            </Box>
            {/* 相机跟踪 */}
            <Box sx={{ p: 1.5, mt: "auto", borderTop: "1px solid", borderColor: "divider" }}>
              <FormControlLabel
                control={<Switch size="small" checked={trackSat} disabled={frame === "inertial"} onChange={(e) => setTrackSat(e.target.checked)} />}
                label="相机跟踪选中卫星"
                title={frame === "inertial" ? "惯性坐标系下不可用（由 ICRF 相机变换接管）" : "视角自动跟随选中卫星（地固系）"}
                sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
              />
            </Box>
          </Box>
        </Slide>
      </Paper>
    </Box>
  );
}
