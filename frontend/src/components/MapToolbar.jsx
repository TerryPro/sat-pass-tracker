import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
// 显示时长哨兵值：-1 表示"全部"，即跟随计算窗口（设置页 hours）
import { ALL_HOURS } from "../constants.js";

// 显示时长选项：6/12/24/48 起步，之后按 24 小时递增到计算窗口之前，
// 保证中间档（72/96/120…）可选；"全部"（哨兵值）= 计算窗口本身。
function visibleHourOptions(hours) {
  const max = hours || 48;
  const opts = [6, 12, 24, 48];
  for (let h = 72; h < max; h += 24) opts.push(h);
  return [...new Set(opts)].filter((h) => h > 0 && h < max).sort((a, b) => a - b);
}

// 底图样式选项：按渲染引擎区分（与运行态势页 Cesium 底图保持一致）
const BASEMAP_OPTIONS = {
  // OpenLayers 引擎：OL 底图样式（Map2D/mapStyles.js）
  ol: [
    { value: "dark", label: "暗色" },
    { value: "light", label: "浅灰" },
    { value: "satellite", label: "卫星" },
    { value: "terrain", label: "地形" },
    { value: "standard", label: "标准" },
  ],
  // Cesium 引擎：底图选项（保留卫星/街道/自然，去掉地形/暗色/夜光/无）
  cesium: [
    { value: "satellite", label: "卫星" },
    { value: "street", label: "街道" },
    { value: "nature", label: "自然" },
  ],
};

// 地图卡片头部控制条：视图切换（2D/3D/both）、参考系、显示时长、底图、投影、
// 经纬网 / 晨昏线 / 可视范围开关、可见段模式。纯展示组件，状态由父级管理。
export default function MapToolbar({
  viewMode, onViewMode,
  eci3d, onEci,
  visibleHours, onVisibleHours, hours,
  mapStyle, onMapStyle,
  basemapEngine = "ol", // 底图选项按引擎：ol（OpenLayers 样式）| cesium（Cesium/运行态势样式）
  basemapDisabled = false, // 地图离线模式：底图锁定为内置离线底图，不可选择其它
  proj, onProj,
  showProj = true, // 是否显示投影切换（Cesium 2D 引擎不支持投影切换，隐藏）
  showGrid, onShowGrid,
  showTerminator, onShowTerminator,
  showVisibility, onShowVisibility,
  passMode, onPassMode,
}) {
  const basemapOptions = basemapDisabled
    ? [{ value: "offline", label: "内置（离线）" }]
    : (BASEMAP_OPTIONS[basemapEngine] || BASEMAP_OPTIONS.ol);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 1.25 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        卫星轨迹
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        sx={{ mr: "auto" }}
        value={viewMode}
        onChange={(e, v) => { if (v) onViewMode(v); }}
        title="切换 2D 星下点地图 / 3D 地球视图 / 同时显示"
      >
        <ToggleButton value="2d">2D</ToggleButton>
        <ToggleButton value="3d">3D</ToggleButton>
        <ToggleButton value="both">2D+3D</ToggleButton>
      </ToggleButtonGroup>
      {viewMode !== "2d" && (
        <FormControl size="small" sx={{ minWidth: 120 }} title="3D 视图参考系：地固系（ECEF）地球固定、轨道相对地表运动；惯性系（ICRF）轨道面与星空空间固定、地球自转">
          <InputLabel>参考系</InputLabel>
          <Select
            value={eci3d ? "inertial" : "body"}
            label="参考系"
            sx={{ height: 32 }}
            onChange={(e) => onEci(e.target.value === "inertial")}
          >
            <MenuItem value="body">地固系（ECEF）</MenuItem>
            <MenuItem value="inertial">惯性系（ICRF）</MenuItem>
          </Select>
        </FormControl>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <FormControl size="small" title="仅显示未来 N 小时内的星下点轨迹">
          <InputLabel>显示时长</InputLabel>
          <Select
            value={visibleHours}
            label="显示时长"
            sx={{ minWidth: 96 }}
            onChange={(e) => onVisibleHours(Number(e.target.value))}
          >
            {/* 固定快捷窗口 + 按 24h 递增到计算窗口；"全部"（=计算窗口）单独列出 */}
            {visibleHourOptions(hours || 48).map((h) => (
              <MenuItem key={h} value={h}>{h}h</MenuItem>
            ))}
            <MenuItem value={ALL_HOURS}>全部（{hours || 48} 小时）</MenuItem>
          </Select>
        </FormControl>
        {/* 底图：2D/3D 均可切换（按引擎显示 OL 或 Cesium 列表，Cesium 列表与运行态势页一致）；
            离线模式下锁定为内置离线底图（value=offline），禁用下拉不可选择其它 */}
        <FormControl size="small">
          <InputLabel>底图</InputLabel>
          <Select
            value={mapStyle}
            label="底图"
            sx={{ minWidth: 96 }}
            disabled={basemapDisabled}
            onChange={(e) => onMapStyle(e.target.value)}
          >
            {basemapOptions.map((b) => (
              <MenuItem key={b.value} value={b.value}>{b.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {(viewMode === "2d" || viewMode === "both") && (
          <>
            {showProj && (
              <FormControl size="small">
                <InputLabel>投影</InputLabel>
                <Select
                  value={proj}
                  label="投影"
                  sx={{ minWidth: 190 }}
                  onChange={(e) => onProj(e.target.value)}
                >
                  <MenuItem value="EPSG:3857">EPSG:3857 (Web Mercator)</MenuItem>
                  <MenuItem value="EPSG:4326">EPSG:4326 (经纬度)</MenuItem>
                </Select>
              </FormControl>
            )}
            <FormControlLabel
              control={<Switch size="small" checked={showTerminator} onChange={(e) => onShowTerminator(e.target.checked)} />}
              label="光照"
              title="光照：显示地球昼夜明暗（太阳光照），2D 叠加晨昏线分界，随实时或推演时间移动"
              sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
            />
          </>
        )}
        <FormControlLabel
          control={<Switch size="small" checked={showGrid} onChange={(e) => onShowGrid(e.target.checked)} />}
          label="经纬网"
          title="在地图上叠加显示经纬网与经纬度标签（2D/3D 通用）"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={showVisibility} onChange={(e) => onShowVisibility(e.target.checked)} />}
          label="可视范围"
          title="显示以地面站为中心、0°仰角可通视的地球表面范围"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
        <FormControl size="small" title="选择显示全部过境的可见段，还是仅当前选中的过境">
          <InputLabel>可见段</InputLabel>
          <Select
            value={passMode}
            label="可见段"
            sx={{ minWidth: 96 }}
            onChange={(e) => onPassMode(e.target.value)}
          >
            <MenuItem value="selected">仅选中</MenuItem>
            <MenuItem value="all">全部</MenuItem>
          </Select>
        </FormControl>
      </Box>
    </Box>
  );
}
