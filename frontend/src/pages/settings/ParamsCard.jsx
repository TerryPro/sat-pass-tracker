// 参数设置卡片：卫星 / 显示时长 / 采样间隔 / 主题 / 晨昏线开关。
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

export default function ParamsCard({ form, satellites, onField, onBoolField, onSave }) {
  return (
    <Paper sx={{ p: 2.5, height: "100%", display: "flex", flexDirection: "column" }}>
      <CardTitle title="参数设置" hint="默认跟踪的卫星、计算参数与界面外观（变更后自动保存）" />

      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        卫星与计算
      </Typography>
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

      <Typography variant="subtitle1" sx={{ mt: 2.5, fontWeight: 600 }}>
        外观
      </Typography>
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

      <Button variant="contained" fullWidth onClick={onSave} sx={{ mt: "auto" }}>
        保存设置
      </Button>
    </Paper>
  );
}
