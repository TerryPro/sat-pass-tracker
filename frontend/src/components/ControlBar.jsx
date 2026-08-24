import React from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import { useSelector } from "react-redux";
// 内置卫星（与后端一致），后端设置未加载时先用于下拉，避免 value 越界警告
import { BUILTIN_SATELLITES } from "../constants.js";

// 列表为空时的稳定回退引用（避免 useSelector 每次返回新数组触发 react-redux 警告）
const EMPTY_STATIONS = [];

// 顶部工具栏（MUI 版）：侧栏开关 / 卫星 / 站点（坐标由站点填充）/ 重新计算。
// 时长与采样间隔在设置页配置（不占用工具栏）。
export default function ControlBar({ params, sidebarVisible, onToggleSidebar, onChange, onRecalc, loading }) {
  // 卫星列表（设置页的卫星管理，内置 + 从网络导入的自定义卫星）
  const satellites = useSelector((s) => s.settings.values?.satellites || BUILTIN_SATELLITES);

  // 地面站列表（来自设置页的后端持久化），选择站点即填充坐标；手动改坐标后自动失配
  const stations = useSelector((s) => s.settings.values?.stations || EMPTY_STATIONS);
  const currentStationId =
    stations.find((st) => st.lat === params.lat && st.lon === params.lon && st.alt === params.alt)?.id || "";

  const selectStation = (e) => {
    const st = stations.find((s) => s.id === e.target.value);
    if (st) onChange({ ...params, lat: st.lat, lon: st.lon, alt: st.alt });
  };

  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        borderBottom: "1px solid",
        borderColor: "divider",
        backgroundColor: "background.paper",
        display: "flex",
        flexWrap: "wrap",
        gap: 1.5,
        alignItems: "center",
      }}
    >
      <FormControlLabel
        control={<Switch size="small" checked={sidebarVisible} onChange={onToggleSidebar} />}
        label="侧栏"
        title="显示 / 隐藏左侧栏（过境列表 + 极坐标图）"
        sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
      />
      <TextField
        select
        size="small"
        label="卫星"
        value={params.satellite}
        sx={{ minWidth: 168 }}
        onChange={(e) => onChange({ ...params, satellite: e.target.value })}
      >
        {satellites.map((s) => (
          <MenuItem key={s.id} value={s.id}>{s.name} ({s.norad_id})</MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="站点"
        value={currentStationId}
        onChange={selectStation}
        sx={{ minWidth: 120 }}
        title="选择地面站（管理见设置页），选中即填充坐标"
      >
        <MenuItem value="" disabled>选择站点</MenuItem>
        {stations.map((st) => (
          <MenuItem key={st.id} value={st.id}>{st.name}</MenuItem>
        ))}
      </TextField>
      <Button size="small" variant="contained" onClick={onRecalc} disabled={loading}>
        {loading ? "计算中…" : "重新计算"}
      </Button>
    </Box>
  );
}
