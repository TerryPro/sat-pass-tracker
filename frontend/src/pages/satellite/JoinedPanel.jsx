// 已加入卫星面板（右）：已加入列表 + 轨道/档案/刷新/移除 + 全部刷新。
// 纯展示组件：数据与操作状态由父级传入，操作通过回调通知父级。
import React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import ArticleIcon from "@mui/icons-material/Article";
import PublicIcon from "@mui/icons-material/Public";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import { fmtDT } from "../../utils/format.js";

export default function JoinedPanel({
  joined = [],
  joinedLoading = false,
  joinedError = "",
  joinedNotice = "",
  refreshingAll = false,
  refreshingId = null,
  onRefreshAll,
  onRefresh,
  onDeactivate,
  onOpenOrbit,
  onOpenInfo,
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, flex: "0 0 auto", width: { xs: "100%", md: 660 }, display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5, flexWrap: "wrap" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          已加入卫星
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {joinedError && <Typography variant="caption" color="error">{joinedError}</Typography>}
          {joinedNotice && <Typography variant="caption" color="success.main">{joinedNotice}</Typography>}
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={onRefreshAll}
            disabled={refreshingAll || joinedLoading}
            title="从网络批量更新全部卫星的轨道数据"
          >
            {refreshingAll ? "更新中…" : "全部刷新"}
          </Button>
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        已选用卫星，支持查看轨道/档案、刷新轨道数据与移除
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Table size="small" stickyHeader sx={{ minWidth: 620 }}>
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell align="right">NORAD</TableCell>
              <TableCell align="right">更新时间</TableCell>
              <TableCell align="right">轨道时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {joinedLoading && joined.length === 0 ? (
              <TableRow><TableCell colSpan={5} align="center"><Typography variant="body2" color="text.secondary">加载中…</Typography></TableCell></TableRow>
            ) : joined.length === 0 ? (
              <TableRow><TableCell colSpan={5} align="center"><Typography variant="body2" color="text.secondary">暂无已加入卫星，可在数据源浏览列点「加入」。</Typography></TableCell></TableRow>
            ) : (
              joined.map((j) => (
                <TableRow key={j.id} hover>
                  <TableCell>{j.name}</TableCell>
                  <TableCell align="right">{j.norad_id}</TableCell>
                  <TableCell align="right" title={j.fetched_at || ""}>{fmtDT(j.fetched_at)}</TableCell>
                  <TableCell align="right" title={j.epoch || ""}>{fmtDT(j.epoch)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" title="轨道信息" onClick={() => onOpenOrbit(Number(j.norad_id))} sx={{ color: "primary.main", bgcolor: "rgba(25,118,210,0.12)", "&:hover": { bgcolor: "primary.main", color: "#fff" } }}>
                      <PublicIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" title="卫星信息" onClick={() => onOpenInfo(Number(j.norad_id))} sx={{ color: "primary.main", bgcolor: "rgba(25,118,210,0.12)", "&:hover": { bgcolor: "primary.main", color: "#fff" } }}>
                      <ArticleIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      title="刷新轨道数据"
                      onClick={() => onRefresh(Number(j.norad_id))}
                      disabled={refreshingId === j.norad_id}
                      sx={{ color: "success.main", bgcolor: "rgba(76,175,80,0.12)", "&:hover": { bgcolor: "success.main", color: "#fff" } }}
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                    {!j.builtin && (
                      <IconButton
                        size="small"
                        title="移除"
                        onClick={() => onDeactivate(j.id)}
                        sx={{ color: "error.main", bgcolor: "rgba(211,47,47,0.12)", "&:hover": { bgcolor: "error.main", color: "#fff" } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
