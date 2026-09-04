// 3D 运行态势页顶部控制栏：组选择 + 场景/底图开关 + 选中星操作。
import React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import ListAltIcon from "@mui/icons-material/ListAlt";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";

export default function SceneControls({
  // 组选择
  group, downloadedGroups = [], onGroupChange, hasRecords, onOpenList,
  // 场景设置
  viewMode, onViewModeChange, frame, onFrameChange,
  basemap, onBasemapChange, basemapDisabled = false, // 地图离线模式：底图锁定为内置离线底图，不可选择其它
  skyOn, onSkyOnChange, hdr, onHdrChange,
  atmosphere, onAtmosphereChange, lighting, onLightingChange,
  showOrbits, onShowOrbitsChange, showNames, onShowNamesChange,
  // 选中星操作
  selectedNorad, onClearSelection, onOpenDetail,
}) {
  // 底图选项：离线模式锁定内置（与 MapToolbar 相同，用扁平数组渲染 MenuItem，
  // 避免三元+Fragment 嵌套导致 MUI Select 无法遍历选项）
  const basemapOptions = basemapDisabled
    ? [{ value: "offline", label: "内置（离线）" }]
    : [
        { value: "satellite", label: "卫星" },
        { value: "street", label: "街道" },
        { value: "nature", label: "自然" },
      ];
  return (
    <Paper sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flexShrink: 0 }}>
      <Select
        size="small"
        displayEmpty
        value={group}
        onChange={(e) => onGroupChange(e.target.value)}
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

      {hasRecords && (
        <IconButton size="small" title="卫星显示列表" onClick={onOpenList}>
          <ListAltIcon fontSize="small" />
        </IconButton>
      )}

      {/* 场景与底图设置：视图切换 / 坐标系 / 底图 / 星空（未选组也可见，地球与背景默认即显示） */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={viewMode}
          onChange={(_, v) => v && onViewModeChange(v)}
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
          onChange={(_, v) => v && onFrameChange(v)}
          title="坐标系：地固（地球固定、卫星相对地表运动）或惯性（轨道相对星空固定、地球自转，仅 3D 生效）"
        >
          <ToggleButton value="fixed">地固</ToggleButton>
          <ToggleButton value="inertial">惯性</ToggleButton>
        </ToggleButtonGroup>
        <FormControl size="small" title="3D 地球底图（离线模式下锁定为内置离线底图）">
          <InputLabel>底图</InputLabel>
          <Select
            value={basemap}
            label="底图"
            sx={{ minWidth: 96 }}
            disabled={basemapDisabled}
            onChange={(e) => onBasemapChange(e.target.value)}
          >
            {basemapOptions.map((b) => (
              <MenuItem key={b.value} value={b.value}>{b.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControlLabel
          control={<Switch size="small" checked={skyOn} onChange={(e) => onSkyOnChange(e.target.checked)} />}
          label="星空"
          title="显示天球星空与大气"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={hdr} onChange={(e) => onHdrChange(e.target.checked)} />}
          label="HDR"
          title="高动态范围渲染：亮部不过曝、暗部保留细节"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={atmosphere} onChange={(e) => onAtmosphereChange(e.target.checked)} />}
          label="大气"
          title="地球边缘的大气散射光晕"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={lighting} onChange={(e) => onLightingChange(e.target.checked)} />}
          label="光照"
          title="太阳光照产生的明暗与阴影（晨昏线）"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={showOrbits} onChange={(e) => onShowOrbitsChange(e.target.checked)} />}
          label="轨道线"
          title="总开关：显示/隐藏所有卫星轨道线（可在卫星列表逐颗控制）"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={showNames} onChange={(e) => onShowNamesChange(e.target.checked)} />}
          label="名字"
          title="在 3D 卫星点上显示/隐藏卫星名字标签"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
      </Box>

      {/* 选中/跟踪卫星：信息面板图标按钮（醒目色）+ 取消跟踪（红底白字），整体靠右 */}
      {selectedNorad != null && (
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          <IconButton size="small" color="warning" title="卫星信息面板" onClick={onOpenDetail}>
            <SatelliteAltIcon fontSize="small" />
          </IconButton>
          <Button size="small" color="error" variant="contained" startIcon={<CloseIcon fontSize="small" />} onClick={onClearSelection}>
            取消跟踪
          </Button>
        </Box>
      )}
    </Paper>
  );
}
