// 参数设置卡片：按「计算 / 轨道数据 / 界面外观」三组组织。
// 纯展示受控组件：值由父级 form 控制，字段变更回调父级（触发自动保存）。
import React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import CalculateIcon from "@mui/icons-material/Calculate";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import PaletteIcon from "@mui/icons-material/Palette";
import { THEMES, HOUR_OPTIONS, SAMPLE_OPTIONS } from "../../constants.js";
import { CardTitle } from "./parts.jsx";
import { hourLabel, sampleLabel, inputSx } from "./helpers.js";

// 运行态势页轨道线颜色预设
const ORBIT_COLORS = [
  { key: "rgba(255,180,70,0.55)", label: "橙色（默认）" },
  { key: "rgba(255,90,90,0.6)", label: "红色" },
  { key: "rgba(90,200,255,0.6)", label: "青色" },
  { key: "rgba(120,230,120,0.6)", label: "绿色" },
  { key: "rgba(240,240,240,0.7)", label: "白色" },
  { key: "rgba(210,140,255,0.6)", label: "紫色" },
];

// 分组标题：彩色小图标 + 标题 + 分隔线
function GroupTitle({ icon, title, color }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 2.5, mb: 1 }}>
      <Box sx={{ display: "flex", color }}>{icon}</Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
    </Box>
  );
}

export default function ParamsCard({ form, satellites, onField, onBoolField, onSave }) {
  return (
    <Paper sx={{ p: 2.5, height: "100%", display: "flex", flexDirection: "column" }}>
      <CardTitle title="参数设置" hint="跟踪计算、轨道数据与界面外观（变更后自动保存）" />

      {/* 计算：过境预测的核心参数 */}
      <GroupTitle icon={<CalculateIcon fontSize="small" />} title="计算" color="#4f8df9" />
      <Divider sx={{ mb: 1 }} />
      <TextField
        select
        label="默认卫星"
        size="small"
        fullWidth
        value={form.satellite}
        onChange={onField("satellite")}
        sx={{ my: 0.75 }}
      >
        {satellites.map((s) => (
          <MenuItem key={s.id} value={s.id}>{s.name} ({s.norad_id})</MenuItem>
        ))}
      </TextField>
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        <TextField
          select
          label="显示时长"
          size="small"
          value={form.hours}
          onChange={onField("hours")}
          sx={inputSx}
          title="过境预测窗口时长（最长 14 天）"
        >
          {[...new Set([...HOUR_OPTIONS, Number(form.hours)])]
            .sort((a, b) => a - b)
            .map((h) => (
              <MenuItem key={h} value={h}>{hourLabel(h)}</MenuItem>
            ))}
        </TextField>
        <TextField
          select
          label="采样间隔"
          size="small"
          value={form.sample_interval}
          onChange={onField("sample_interval")}
          sx={inputSx}
          title="过境 az/el 采样间隔（秒）"
        >
          {[...new Set([...SAMPLE_OPTIONS, Number(form.sample_interval)])]
            .sort((a, b) => a - b)
            .map((s) => (
              <MenuItem key={s} value={s}>{sampleLabel(s)}</MenuItem>
            ))}
        </TextField>
      </Box>
      <TextField
        select
        label="2D 地图引擎"
        size="small"
        fullWidth
        value={form.map2d_engine || "ol"}
        onChange={onField("map2d_engine")}
        sx={{ my: 0.75 }}
        title="2D 星下点地图的渲染引擎：OpenLayers（稳定默认）或 Cesium 2D（新引擎，对照测试中）"
      >
        <MenuItem value="ol">OpenLayers（默认）</MenuItem>
        <MenuItem value="cesium">Cesium 2D（测试中）</MenuItem>
      </TextField>
      <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mb: 0.5 }}>
        Cesium 2D 引擎固定使用 EPSG:4326 投影（投影切换在该引擎下不可用）
      </Typography>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={!!form.map_offline}
            onChange={onBoolField("map_offline")}
          />
        }
        label="地图离线模式：强制使用内置离线底图"
        sx={{ my: 0.5 }}
      />
      <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mb: 0.5 }}>
        离线模式：地图底图固定为随应用内置的本地影像，完全不联网，且不可切换其它底图；关闭后恢复在线底图选择
      </Typography>

      {/* 轨道数据：TLE 获取策略 */}
      <GroupTitle icon={<CloudSyncIcon fontSize="small" />} title="轨道数据" />
      <Divider sx={{ mb: 1 }} />
      <TextField
        select
        label="轨道数据来源"
        size="small"
        fullWidth
        value={form.tle_mode || "online"}
        onChange={onField("tle_mode")}
        sx={{ my: 0.75 }}
        title="在线自动更新会联网获取最新轨道数据；内置/本地模式不联网，立即返回缓存或内置数据"
      >
        <MenuItem value="online">在线自动更新（默认）</MenuItem>
        <MenuItem value="builtin">内置/本地缓存（离线，不联网）</MenuItem>
      </TextField>
      <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mb: 0.5 }}>
        内置/本地模式：使用本地缓存或内置历史轨道数据，计算更快、可离线；数据可能过时
      </Typography>

      {/* 界面外观：主题 / 时间 / 轨道线颜色 / 地图显示 */}
      <GroupTitle icon={<PaletteIcon fontSize="small" />} title="界面外观" color="#ab47bc" />
      <Divider sx={{ mb: 1 }} />
      <TextField
        select
        label="主题"
        size="small"
        fullWidth
        value={form.theme}
        onChange={onField("theme")}
        sx={{ my: 0.75 }}
      >
        {THEMES.map((t) => (
          <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="时间显示"
        size="small"
        fullWidth
        value={form.time_display}
        onChange={onField("time_display")}
        sx={{ my: 0.75 }}
        title="界面时间显示采用 UTC 还是本地时区"
      >
        <MenuItem value="utc">UTC 时间</MenuItem>
        <MenuItem value="local">本地时间</MenuItem>
      </TextField>
      <TextField
        select
        label="轨道线颜色"
        size="small"
        fullWidth
        value={form.orbit_color || "rgba(255,180,70,0.55)"}
        onChange={onField("orbit_color")}
        sx={{ my: 0.75 }}
        title="运行态势页面中卫星轨道线的颜色"
      >
        {ORBIT_COLORS.map((c) => (
          <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>
        ))}
      </TextField>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={!!form.terminator_show_dashed}
            onChange={onBoolField("terminator_show_dashed")}
          />
        }
        label="晨昏线：显示橘色虚线分界（关闭后仅显示夜影阴影）"
        sx={{ my: 0.5 }}
      />
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={!!form.map_click_link}
            onChange={onBoolField("map_click_link")}
          />
        }
        label="单击地图联动：点击地图跳到最近轨迹点"
        sx={{ my: 0.5 }}
        title="开启后，在 Cesium 2D/3D 地图上单击即可把时间轴跳到点击位置最近的卫星轨迹点"
      />
      <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mb: 0.5 }}>
        默认关闭；单击联动当前适用于 Cesium 引擎的 2D/3D 视图
      </Typography>

      <Button variant="contained" fullWidth onClick={onSave} sx={{ mt: "auto" }}>
        保存设置
      </Button>
    </Paper>
  );
}
