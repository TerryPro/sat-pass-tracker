import React, { useEffect } from "react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import { miniOption, CHART_PALETTES } from "../chartUtils.js";
import { useAppTheme } from "../hooks/useAppTheme.js";
import { useEChart } from "../hooks/useEChart.js";

// 最大仰角 → 标签配色（低/中/高，语义色在亮暗主题下通用）
function elTagColor(el) {
  if (el < 10) return { bg: "rgba(239,68,68,0.15)", color: "#f87171" };
  if (el < 45) return { bg: "rgba(251,191,36,0.18)", color: "#fbbf24" };
  return { bg: "rgba(34,197,94,0.18)", color: "#4ade80" };
}

function countdown(aosIso) {
  const ms = new Date(aosIso).getTime() - Date.now();
  if (ms <= 0) return "进行中";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m ${Math.floor(s % 60)}s`;
}

function fmtHM(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function MiniChart({ pass }) {
  // 迷你图配色跟随应用主题
  const theme = useAppTheme();
  const { ref, chartRef } = useEChart(true);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(miniOption(pass, CHART_PALETTES[theme] || CHART_PALETTES.dark), true);
  }, [pass, theme]);
  return <div ref={ref} style={{ width: 130, height: 72 }} />;
}

// 左侧过境列表：每行显示编号/时间/时长/Max/AOS-LOS 方位 + mini 极坐标缩略图
export default function PassList({ passes, activeIdx, onSelect, compact, onToggleCompact }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        borderRadius: 1.25, // 与原 .card 的 10px 一致
        flex: "0 0 calc(50% - 6px)", // 在 sidebar 中占上半部分（原 .sidebar > .card）
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          过境列表
        </Typography>
        <FormControlLabel
          control={<Switch size="small" checked={compact} onChange={onToggleCompact} />}
          label="精简"
          title="精简左侧栏，为右侧地图腾出空间"
          sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
        />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {passes.map((p, i) => {
          const d0 = new Date(p.aos);
          const d1 = new Date(p.los);
          const active = i === activeIdx;
          const tag = elTagColor(p.max_elevation_deg);
          return (
            <Box
              key={p.index}
              onClick={() => onSelect(i)}
              sx={{
                display: "grid",
                gridTemplateColumns: compact ? "auto 1fr auto" : "auto 1.7fr 1.7fr 1.7fr 130px",
                gap: compact ? 0.75 : 1.25,
                alignItems: "center",
                px: 1,
                py: compact ? 1 : 1.25,
                borderBottom: "1px solid",
                borderColor: "divider",
                cursor: "pointer",
                bgcolor: active ? "action.selected" : "transparent",
                transition: "background-color 0.15s ease",
                fontSize: compact ? 12 : 13,
                "&:hover": { bgcolor: active ? "action.selected" : "action.hover" },
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700, color: "text.secondary", fontSize: compact ? 11 : 13 }}>
                #{String(p.index).padStart(2, "0")}
              </Typography>

              <Box sx={{ lineHeight: compact ? 1.4 : 1.5 }}>
                <Typography variant="body2" sx={{ whiteSpace: "nowrap", color: "text.primary", fontSize: compact ? 12 : 13 }}>
                  {d0.toLocaleTimeString("zh-CN", { hour12: false })}
                  {" → "}
                  {d1.toLocaleTimeString("zh-CN", { hour12: false })}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap", fontSize: compact ? 11 : 12 }}>
                  {d0.toLocaleDateString("zh-CN")} · {countdown(p.aos)}
                </Typography>
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", lineHeight: 1.6, color: "text.secondary", fontSize: compact ? 11 : 12 }}>
                <Box sx={{ whiteSpace: "nowrap" }}>
                  时长{" "}
                  <Box component="b" sx={{ color: "text.primary", fontWeight: 600 }}>
                    {fmtHM(p.duration_sec)}
                  </Box>
                </Box>
                <Box sx={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 0.5 }}>
                  Max{" "}
                  <Chip
                    size="small"
                    label={`${p.max_elevation_deg.toFixed(1)}°`}
                    sx={{
                      height: 18,
                      fontSize: 11,
                      fontWeight: 600,
                      bgcolor: tag.bg,
                      color: tag.color,
                      "& .MuiChip-label": { px: 0.8 },
                    }}
                  />
                </Box>
              </Box>

              {!compact && (
                <Box sx={{ display: "flex", flexDirection: "column", lineHeight: 1.6, color: "text.secondary", fontSize: 12 }}>
                  <Box sx={{ whiteSpace: "nowrap" }}>
                    AOS{" "}
                    <Box component="b" sx={{ color: "text.primary", fontWeight: 600 }}>
                      {p.aos_az.toFixed(0)}°
                    </Box>
                  </Box>
                  <Box sx={{ whiteSpace: "nowrap" }}>
                    Peak{" "}
                    <Box component="b" sx={{ color: "text.primary", fontWeight: 600 }}>
                      {p.peak_az.toFixed(0)}°
                    </Box>
                  </Box>
                  <Box sx={{ whiteSpace: "nowrap" }}>
                    LOS{" "}
                    <Box component="b" sx={{ color: "text.primary", fontWeight: 600 }}>
                      {p.los_az.toFixed(0)}°
                    </Box>
                  </Box>
                </Box>
              )}

              {!compact && <MiniChart pass={p} />}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
