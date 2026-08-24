import React from "react";
import Box from "@mui/material/Box";
// 短时间格式（仅时分秒）：复用 chartUtils 统一格式化
import { fmtTime } from "../chartUtils.js";

// 信息标签（选中过境 / 实时位置 / 推演位置）
function InfoTag({ color, children }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        flex: "0 0 auto",
        px: 0.75,
        borderRadius: "4px",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.5,
        color: "#fff",
        bgcolor: color,
      }}
    >
      {children}
    </Box>
  );
}

// 可见性徽标（可见绿 / 不可见灰）
function RtBadge({ visible }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        px: 0.75,
        borderRadius: "4px",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        bgcolor: visible ? "rgba(34,197,94,0.18)" : "rgba(148,163,184,0.15)",
        color: visible ? "#4ade80" : "var(--muted)",
      }}
    >
      {visible ? "可见" : "不可见"}
    </Box>
  );
}

// 信息条中的强调值（等宽数字）
function IB({ children }) {
  return (
    <Box component="b" sx={{ color: "text.primary", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
      {children}
    </Box>
  );
}

// 地图下方信息条：选中过境详情（AOS/LOS/时长/最大仰角/方位）+ 卫星标记信息
// （实时模式用实时位置，推演模式用时间轴当前点）。纯展示组件。
export default function InfoBar({ activePass, liveMode, currentPos, gt, idx }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "8px 16px",
        flexWrap: "wrap",
        px: 1,
        py: 0.5,
        mt: 1,
        borderRadius: "6px",
        bgcolor: "var(--overlay-soft)",
      }}
    >
      {/* 段1：选中过境的详细信息（始终显示） */}
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: 12, color: "text.secondary", lineHeight: 1.5 }}>
        <InfoTag color="#7c3aed">选中过境</InfoTag>
        {activePass ? (
          <>
            AOS <IB>{fmtTime(activePass.aos)}</IB> · LOS <IB>{fmtTime(activePass.los)}</IB> ·{" "}
            <IB>{Math.round(activePass.duration_sec / 60)} min</IB> · 最大仰角{" "}
            <IB>{activePass.max_elevation_deg.toFixed(1)}°</IB> · AOS方位{" "}
            <IB>{activePass.aos_az.toFixed(1)}°</IB> · LOS方位 <IB>{activePass.los_az.toFixed(1)}°</IB>
          </>
        ) : (
          <>暂无选中过境</>
        )}
      </Box>
      {/* 段2：卫星标记信息，按显示模式切换 —— 实时模式用实时位置，播放模式用时间轴当前点 */}
      {(() => {
        const sel = liveMode ? currentPos : (gt.points[idx] || null);
        const label = liveMode ? "实时位置" : "推演位置";
        return (
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: 12, color: "text.secondary", lineHeight: 1.5 }}>
            <InfoTag color="#d97706">{label}</InfoTag>
            {sel ? (
              <>
                <RtBadge visible={sel.el >= 0} />{" "}
                经纬{" "}
                <IB>
                  {sel.lat.toFixed(2)}°, {sel.lon.toFixed(2)}°
                </IB>{" "}
                · 仰角 <IB>{sel.el.toFixed(1)}°</IB> · 方位 <IB>{sel.az.toFixed(1)}°</IB> · 斜距{" "}
                <IB>{sel.r_km.toFixed(0)} km</IB>
              </>
            ) : (
              <>等待卫星数据…</>
            )}
          </Box>
        );
      })()}
    </Box>
  );
}
