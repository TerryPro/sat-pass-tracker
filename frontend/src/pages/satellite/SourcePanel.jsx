// 数据源面板（左）：CelesTrak 分类树 + 各组的下载/更新按钮。
// 纯展示组件：分类/下载状态由父级传入，下载与选组通过回调通知父级。
import React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import DownloadIcon from "@mui/icons-material/Download";
import CloudDoneIcon from "@mui/icons-material/CloudDone";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";
import CloudIcon from "@mui/icons-material/Cloud";
import WifiIcon from "@mui/icons-material/Wifi";
import ExploreIcon from "@mui/icons-material/Explore";
import ScienceIcon from "@mui/icons-material/Science";
import CategoryIcon from "@mui/icons-material/Category";
import { fmtDT } from "../../utils/format.js";

// 分类 meta 的图标 + 主色（六类，与后端 lib.CELESTRAK_CATEGORIES 的 key 对应）
const CATEGORY_STYLE = {
  special: { icon: <SatelliteAltIcon fontSize="small" />, color: "#5c6bc0" },
  weather: { icon: <CloudIcon fontSize="small" />, color: "#29b6f6" },
  comm: { icon: <WifiIcon fontSize="small" />, color: "#66bb6a" },
  nav: { icon: <ExploreIcon fontSize="small" />, color: "#ffa726" },
  science: { icon: <ScienceIcon fontSize="small" />, color: "#ab47bc" },
  misc: { icon: <CategoryIcon fontSize="small" />, color: "#26a69a" },
};

export default function SourcePanel({
  categories = [],
  downloadingKey = "",
  error = "",
  selectedGroup = "",
  onSelectGroup,
  onDownload,
  onDismissError,
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, flex: "0 0 auto", width: { xs: "100%", md: 300 }, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
        数据源
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        下载并管理各数据源的原始 TLE 文件
      </Typography>
      {error && (
        <Alert severity="error" size="small" sx={{ mb: 1 }} onClose={onDismissError}>
          {error}
        </Alert>
      )}
      <Box component="div" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {categories.map((cat) => (
          <Box key={cat.key} sx={{ mb: 1 }}>
            <Box
              sx={{
                display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.5, mb: 0.75,
                borderRadius: 1, borderLeft: "3px solid",
                bgcolor: `${CATEGORY_STYLE[cat.key]?.color || "#888"}1A`,
                borderColor: CATEGORY_STYLE[cat.key]?.color || "#888",
              }}
            >
              <Box sx={{ display: "flex", color: CATEGORY_STYLE[cat.key]?.color || "inherit" }}>
                {CATEGORY_STYLE[cat.key]?.icon}
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 700, color: CATEGORY_STYLE[cat.key]?.color || "text.primary" }}>
                {cat.label}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
              {cat.groups.map((g) => {
                const isSelected = selectedGroup === g.key;
                return (
                  <Box
                    key={g.key}
                    onClick={g.downloaded ? () => onSelectGroup(g.key) : undefined}
                    sx={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1,
                      border: "1px solid", borderRadius: 1, p: 0.75,
                      borderColor: isSelected ? "primary.main" : "divider",
                      bgcolor: isSelected ? "action.selected" : "transparent",
                      cursor: g.downloaded ? "pointer" : "default",
                      "&:hover": g.downloaded ? { bgcolor: "action.hover" } : undefined,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                        {g.downloaded ? <CloudDoneIcon fontSize="small" color="success" /> : null}
                        <Typography variant="body2" sx={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {g.label}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.downloaded ? `${g.count} 颗 · ${fmtDT(g.fetched_at)}` : "未下载"}
                      </Typography>
                    </Box>
                    {g.downloaded ? (
                      <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 0.5 }}>
                        {downloadingKey === g.key ? (
                          <Typography variant="caption" color="text.secondary">下载中…</Typography>
                        ) : (
                          <Button
                            size="small"
                            variant="text"
                            startIcon={<DownloadIcon />}
                            onClick={(e) => { e.stopPropagation(); onDownload(g.key); }}
                            disabled={!!downloadingKey}
                            sx={{ flexShrink: 0, minWidth: 56 }}
                          >
                            更新
                          </Button>
                        )}
                      </Box>
                    ) : downloadingKey === g.key ? (
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>下载中…</Typography>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<DownloadIcon />}
                        onClick={(e) => { e.stopPropagation(); onDownload(g.key); }}
                        disabled={!!downloadingKey}
                        sx={{ flexShrink: 0, minWidth: 56 }}
                      >
                        下载
                      </Button>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
        {categories.length === 0 && (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
            加载数据源中…
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
