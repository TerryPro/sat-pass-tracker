// 数据浏览面板（中）：选择数据源组 + 搜索 + 已下载卫星表格（加入/轨道/档案）。
// 纯展示组件：搜索与选组受父级控制，操作通过回调通知父级。
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
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import SearchIcon from "@mui/icons-material/Search";
import ArticleIcon from "@mui/icons-material/Article";
import PublicIcon from "@mui/icons-material/Public";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";

export default function BrowserTable({
  entries = [],
  count = -1,
  searching = false,
  joined = [],
  groupEmpty = false,
  q = "",
  downloadedGroups = [],
  selectedGroup = "",
  onSearchChange,
  onSelectGroup,
  onActivate,
  onOpenOrbit,
  onOpenInfo,
}) {
  const isJoined = (noradId) => joined.some((j) => Number(j.norad_id) === Number(noradId));

  return (
    <Paper sx={{ p: 2.5, flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          已下载的数据
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {/* 选择要查看的数据源组（未选时右侧显示提示） */}
          <Select
            size="small"
            displayEmpty
            value={selectedGroup}
            onChange={(e) => onSelectGroup(e.target.value)}
            sx={{ minWidth: 220 }}
            renderValue={(v) => {
              if (!v) return <Typography variant="body2" color="text.secondary">选择组…</Typography>;
              const g = downloadedGroups.find((x) => x.key === v);
              return g ? g.label : v;
            }}
          >
            {downloadedGroups.length === 0 && (
              <MenuItem value="" disabled>暂无已下载的组</MenuItem>
            )}
            {downloadedGroups.map((g) => (
              <MenuItem key={g.key} value={g.key}>{g.label}</MenuItem>
            ))}
          </Select>
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        在所选数据源中浏览卫星，可查看轨道与档案信息
      </Typography>
      <Box sx={{ mb: 1.5 }}>
        <TextField
          label="搜索名称 / NORAD"
          size="small"
          fullWidth
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
            ),
          }}
        />
      </Box>
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell align="right">NORAD</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {searching && entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} align="center">
                  <Typography variant="body2" color="text.secondary">搜索中…</Typography>
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} align="center">
                  <Typography variant="body2" color="text.secondary">
                    {groupEmpty
                      ? "请选择要查看的组（右侧下拉或左侧点击已下载的组）。"
                      : q
                        ? "没有匹配的卫星"
                        : "尚未下载任何数据源，请先点击左侧「数据源」面板下载。"}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.norad_id} hover>
                  <TableCell>{e.name}</TableCell>
                  <TableCell align="right">{e.norad_id}</TableCell>
                  <TableCell align="right">
                    {isJoined(e.norad_id) ? (
                      <IconButton
                        size="small"
                        aria-label={`已加入 ${e.name}`}
                        title="已加入"
                        disabled
                        sx={{ color: "success.main", bgcolor: "rgba(46,125,50,0.12)" }}
                      >
                        <CheckIcon fontSize="small" />
                      </IconButton>
                    ) : (
                      <IconButton
                        size="small"
                        aria-label={`加入 ${e.name}`}
                        title="加入"
                        onClick={() => onActivate(e.norad_id)}
                        sx={{
                          color: "primary.main",
                          bgcolor: "rgba(25, 118, 210, 0.12)",
                          "&:hover": { bgcolor: "primary.main", color: "#fff" },
                        }}
                      >
                        <AddIcon fontSize="small" />
                      </IconButton>
                    )}
                    {/* 轨道信息（离线，TLE 解析） */}
                    <IconButton
                      size="small"
                      aria-label={`轨道 ${e.name}`}
                      title="轨道信息"
                      onClick={() => onOpenOrbit(e.norad_id)}
                      sx={{
                        color: "primary.main",
                        bgcolor: "rgba(25, 118, 210, 0.12)",
                        "&:hover": { bgcolor: "primary.main", color: "#fff" },
                      }}
                    >
                      <PublicIcon fontSize="small" />
                    </IconButton>
                    {/* 卫星档案信息（SatNOGS + AMSAT） */}
                    <IconButton
                      size="small"
                      aria-label={`卫星信息 ${e.name}`}
                      title="卫星信息"
                      onClick={() => onOpenInfo(e.norad_id)}
                      sx={{
                        color: "primary.main",
                        bgcolor: "rgba(25, 118, 210, 0.12)",
                        "&:hover": { bgcolor: "primary.main", color: "#fff" },
                      }}
                    >
                      <ArticleIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {count >= 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          共 {count} 条
        </Typography>
      )}
    </Paper>
  );
}
