// 3D 运行态势页：左侧选中星详情面板（实时状态 + 轨道要素 + 相机跟踪开关）。
// 详情数据（星下点/速度/轨道要素）在内部按播放时刻实时计算。
import React, { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import Slide from "@mui/material/Slide";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import { subpoint, speedAt, orbitElements } from "../../sat/satmath.mjs";
import { fmtHMS } from "../../utils/format.js";

// 详情面板行：label + value 两端对齐
function InfoRow({ label, value }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, minWidth: 0 }}>
      <Box component="span" sx={{ color: "text.secondary", flexShrink: 0 }}>{label}</Box>
      <Box component="span" sx={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value ?? "—"}</Box>
    </Box>
  );
}

export default function SatInfoPanel({
  open,
  onClose,
  records = [],
  selectedNorad,
  playedDate,
  timeDisplay = "utc",
  trackSat,
  onTrackChange,
  frame = "fixed",
}) {
  // 选中星详情：实时位置/高度/速度 + 轨道要素（随播放时刻实时更新）
  const detail = useMemo(() => {
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

  return (
    <Slide direction="right" in={open && !!detail} mountOnEnter unmountOnExit>
      <Box sx={{ position: "absolute", top: 0, left: 0, bottom: 120, width: 340, maxWidth: "88%", bgcolor: "background.paper", borderRight: "1px solid", borderColor: "divider", boxShadow: "8px 0 24px rgba(0,0,0,0.3)", zIndex: 4, display: "flex", flexDirection: "column" }}>
        {/* 头部 */}
        <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={detail?.name}>
              {detail?.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>NORAD {detail?.norad}</Typography>
          </Box>
          <IconButton size="small" title="关闭" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Box>
        {/* 实时状态 */}
        <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary">实时状态（{fmtHMS(playedDate, timeDisplay)}）</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", mt: 0.75, fontSize: 13 }}>
            <InfoRow label="纬度" value={detail?.valid ? `${detail.lat.toFixed(2)}°` : "—"} />
            <InfoRow label="经度" value={detail?.valid ? `${detail.lon.toFixed(2)}°` : "—"} />
            <InfoRow label="高度" value={detail?.valid ? `${Math.round(detail.altKm)} km` : "—"} />
            <InfoRow label="速度" value={detail?.speedKmS != null ? `${detail.speedKmS.toFixed(2)} km/s` : "—"} />
          </Box>
        </Box>
        {/* 轨道要素 */}
        <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary">轨道要素</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", mt: 0.75, fontSize: 13 }}>
            <InfoRow label="倾角" value={detail ? `${detail.inclDeg.toFixed(2)}°` : "—"} />
            <InfoRow label="升交点赤经" value={detail ? `${detail.raanDeg.toFixed(2)}°` : "—"} />
            <InfoRow label="近地点幅角" value={detail ? `${detail.argpDeg.toFixed(2)}°` : "—"} />
            <InfoRow label="偏心率" value={detail ? detail.ecc.toFixed(5) : "—"} />
            <InfoRow label="轨道周期" value={detail ? `${detail.periodMin.toFixed(1)} min` : "—"} />
            <InfoRow label="近地点" value={detail ? `${Math.round(detail.perigeeKm)} km` : "—"} />
            <InfoRow label="远地点" value={detail ? `${Math.round(detail.apogeeKm)} km` : "—"} />
          </Box>
        </Box>
        {/* 相机跟踪 */}
        <Box sx={{ p: 1.5, mt: "auto", borderTop: "1px solid", borderColor: "divider" }}>
          <FormControlLabel
            control={<Switch size="small" checked={trackSat} disabled={frame === "inertial"} onChange={(e) => onTrackChange(e.target.checked)} />}
            label="相机跟踪选中卫星"
            title={frame === "inertial" ? "惯性坐标系下不可用（由 ICRF 相机变换接管）" : "视角自动跟随选中卫星（地固系）"}
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
          />
        </Box>
      </Box>
    </Slide>
  );
}
