// 卫星档案信息弹窗：SatNOGS 基本信息 + AMSAT 频率（本地缓存，可强制刷新）。
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import RefreshIcon from "@mui/icons-material/Refresh";
import { fmtDT } from "../../utils/format.js";

export default function InfoDialog({
  open,
  onClose,
  noradId = null,
  info = null,
  infoLoading = false,
  infoError = "",
  infoRefreshing = false,
  onRefreshInfo,
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>
        卫星信息
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          NORAD {noradId}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {infoLoading ? (
          <Typography variant="body2" color="text.secondary">加载档案信息…</Typography>
        ) : infoError ? (
          <Typography variant="body2" color="error">{infoError}</Typography>
        ) : info && info.found ? (
          <>
            {info.image_url ? (
              <Box sx={{ display: "flex", justifyContent: "center", mb: 1.5 }}>
                <Box
                  component="img"
                  src={info.image_url}
                  alt={info.names || "卫星图片"}
                  onError={(e) => { e.target.style.display = "none"; }}
                  sx={{
                    maxWidth: "100%", maxHeight: 180,
                    borderRadius: 1, border: "1px solid",
                    borderColor: "divider", objectFit: "contain",
                  }}
                />
              </Box>
            ) : null}
            <Box component="div" sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              {[
                ["别名", info.names],
                ["状态", info.status],
                ["发射日期", info.launch_date ? new Date(info.launch_date).toLocaleDateString("zh-CN") : ""],
                ["运营商", info.operator],
                ["所属国家", info.countries],
                ["遥测解码器", info.telemetries?.join("、")],
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: "flex", justifyContent: "space-between", py: 0.5, borderBottom: "1px dashed", borderColor: "divider" }}>
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography variant="body2" sx={{ ml: 1, textAlign: "right", wordBreak: "break-all" }}>{value || "—"}</Typography>
                </Box>
              ))}
            </Box>
            {info.website ? (
              <Typography variant="body2" sx={{ mt: 1 }}>
                官网:{" "}
                <a href={info.website} target="_blank" rel="noreferrer" style={{ color: "#90caf9", wordBreak: "break-all" }}>
                  {info.website}
                </a>
              </Typography>
            ) : null}
            {(info.frequencies && info.frequencies.length > 0) && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>业余频率</Typography>
                {info.frequencies.map((f, i) => (
                  <Typography key={i} variant="body2" sx={{ mb: 0.25 }}>
                    上行 {f.uplink || "—"} · 下行 {f.downlink || "—"} · 信标 {f.beacon || "—"} · {f.mode || ""}
                  </Typography>
                ))}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              最近更新 {fmtDT(info.fetched_at)}（本地缓存）
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            该数据源暂未收录此卫星的档案信息。
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={onRefreshInfo}
          disabled={infoLoading || infoRefreshing}
        >
          {infoRefreshing ? "刷新中…" : "强制刷新档案"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
