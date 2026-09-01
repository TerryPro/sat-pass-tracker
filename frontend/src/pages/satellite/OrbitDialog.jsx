// 轨道信息弹窗：从 TLE 解析的轨道根数 + TLE 原文。
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import { ORBIT_LABELS } from "../../constants.js";

export default function OrbitDialog({
  open,
  onClose,
  noradId = null,
  detail = null,
  detailLoading = false,
  detailError = "",
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>
        {detail?.name || ""}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          NORAD {detail?.norad_id ?? noradId} · {detail?.source || ""}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {detailLoading ? (
          <Typography variant="body2" color="text.secondary">加载中…</Typography>
        ) : detailError ? (
          <Typography variant="body2" color="error">{detailError}</Typography>
        ) : detail ? (
          <>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>轨道参数</Typography>
            <Box component="div" sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              {Object.entries(ORBIT_LABELS).map(([key, label]) => (
                <Box
                  key={key}
                  sx={{
                    display: "flex", justifyContent: "space-between", py: 0.5,
                    borderBottom: "1px dashed", borderColor: "divider",
                  }}
                >
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography variant="body2" sx={{ ml: 1, textAlign: "right", wordBreak: "break-all" }}>
                    {detail.orbit?.[key] ?? "—"}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>TLE</Typography>
              <Typography variant="caption" sx={{ fontFamily: "monospace", wordBreak: "break-all", display: "block", lineHeight: 1.6 }}>
                {detail.tle1}
                <br />
                {detail.tle2}
              </Typography>
            </Box>
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}
