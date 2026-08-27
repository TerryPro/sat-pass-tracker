// 卫星管理页：数据源文件管理 + 本地卫星库数据浏览。
//   - 数据源面板：从 CelesTrak 组下载常用卫星 TLE 文件，本地持久化（后台管理）。
//   - 数据浏览：查看已下载原始文件解析出的卫星（名称/NORAD 搜索）。
// 与"已加入"卫星列表（设置页/轨迹页）保持独立，本页暂不做加入操作。
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import DownloadIcon from "@mui/icons-material/Download";
import SearchIcon from "@mui/icons-material/Search";
import CloudDoneIcon from "@mui/icons-material/CloudDone";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";
import CloudIcon from "@mui/icons-material/Cloud";
import WifiIcon from "@mui/icons-material/Wifi";
import ExploreIcon from "@mui/icons-material/Explore";
import ScienceIcon from "@mui/icons-material/Science";
import CategoryIcon from "@mui/icons-material/Category";
import { useDispatch, useSelector } from "react-redux";
import {
  loadLibraryMeta,
  downloadLibrarySource,
  loadLibraryEntries,
  clearLibraryError,
  clearEntries,
} from "../slices/librarySlice.js";

// 分类 meta 的图标 + 主色（六类，与后端 lib.CELESTRAK_CATEGORIES 的 key 对应）
const CATEGORY_STYLE = {
  special: { icon: <SatelliteAltIcon fontSize="small" />, color: "#5c6bc0" },
  weather: { icon: <CloudIcon fontSize="small" />, color: "#29b6f6" },
  comm: { icon: <WifiIcon fontSize="small" />, color: "#66bb6a" },
  nav: { icon: <ExploreIcon fontSize="small" />, color: "#ffa726" },
  science: { icon: <ScienceIcon fontSize="small" />, color: "#ab47bc" },
  misc: { icon: <CategoryIcon fontSize="small" />, color: "#26a69a" },
};

// ISO → 本地 MM-DD HH:mm（紧凑展示）
function fmtDT(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SatellitePage() {
  const dispatch = useDispatch();
  const meta = useSelector((s) => s.library.meta);
  const entriesState = useSelector((s) => s.library.entries);
  const searching = useSelector((s) => s.library.searching);
  const downloadingKey = useSelector((s) => s.library.downloadingKey);
  const error = useSelector((s) => s.library.error);
  const [q, setQ] = useState("");
  // 当前选中查看的组（只按选中组浏览；空 = 尚未选择，右侧提示）
  const [selectedGroup, setSelectedGroup] = useState("");

  // 请求竞态防护：递增序号，store 只采纳最新的（latest-wins）
  const reqSeqRef = useRef(0);
  const nextSeq = () => ++reqSeqRef.current;

  // 页面挂载：仅加载数据源元信息；条目等用户选中某个组后再加载
  useEffect(() => {
    dispatch(loadLibraryMeta());
  }, [dispatch]);

  const entries = entriesState?.entries || [];

  const groupEmpty = selectedGroup === ""; // 尚未选中任何组
  // 显示层：未选组时视为空
  const displayEntries = groupEmpty ? [] : entries;

  // 选中组变化：立即加载该组（未选组时清空展示）
  useEffect(() => {
    if (groupEmpty) {
      dispatch(clearEntries());
      return;
    }
    dispatch(loadLibraryEntries({ q: q.trim(), source: selectedGroup, seq: nextSeq() }));
  }, [selectedGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // 搜索输入：防抖 300ms（仅作用于当前选中的组）
  useEffect(() => {
    if (groupEmpty) return;
    const id = setTimeout(() => {
      dispatch(loadLibraryEntries({ q: q.trim(), source: selectedGroup, seq: nextSeq() }));
    }, 300);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMetaErrorDismiss = () => dispatch(clearLibraryError());

  const handleDownload = (key) => {
    dispatch(downloadLibrarySource(key)).then(() => {
      // 下载完成后刷新 meta；若尚未选组则自动选中刚下载的组，否则刷新当前组
      dispatch(loadLibraryMeta());
      if (groupEmpty) setSelectedGroup(key);
      else dispatch(loadLibraryEntries({ q: q.trim(), source: selectedGroup, seq: nextSeq() }));
    });
  };

  const categories = meta?.categories || [];
  const downloadedGroups = (meta?.groups || []).filter((g) => g.downloaded);
  return (
    <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "hidden", minHeight: 0 }}>
      <Typography variant="h6" sx={{ mb: 0, flexShrink: 0 }}>
        卫星管理
      </Typography>

      {/* 左右分栏：左=数据源(窄)，右=已下载数据浏览 */}
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, flex: 1, minHeight: 0 }}>
        {/* 数据源面板（左，较窄）：下载/更新各组的原始 TLE 文件 */}
        <Paper
          variant="outlined"
          sx={{ p: 1.5, flex: "0 0 auto", width: { xs: "100%", md: 320 }, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            数据源
          </Typography>
          {error && (
            <Alert severity="error" size="small" sx={{ mb: 1 }} onClose={handleMetaErrorDismiss}>
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
                        onClick={g.downloaded ? () => setSelectedGroup(g.key) : undefined}
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
                                onClick={(e) => { e.stopPropagation(); handleDownload(g.key); }}
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
                            onClick={(e) => { e.stopPropagation(); handleDownload(g.key); }}
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

        {/* 数据浏览面板（右，占满剩余）：查看已下载原始文件解析出的卫星 */}
        <Paper sx={{ p: 2.5, flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
            <Typography variant="h6" sx={{ mb: 0 }}>
              已下载的数据
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {/* 选择要查看的数据源组（未选时右侧显示提示） */}
              <Select
                size="small"
                displayEmpty
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
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
          <Box sx={{ mb: 1.5 }}>
            <TextField
              label="搜索名称 / NORAD"
              size="small"
              fullWidth
              value={q}
              onChange={(e) => setQ(e.target.value)}
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
                  <TableCell>来源组</TableCell>
                  <TableCell align="right">TLE 时间</TableCell>
                  <TableCell sx={{ minWidth: 320 }}>TLE</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {searching && displayEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography variant="body2" color="text.secondary">搜索中…</Typography>
                    </TableCell>
                  </TableRow>
                ) : displayEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
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
                  displayEntries.map((e) => (
                    <TableRow key={e.norad_id} hover>
                      <TableCell>{e.name}</TableCell>
                      <TableCell align="right">{e.norad_id}</TableCell>
                      <TableCell>{e.source || "—"}</TableCell>
                      <TableCell align="right" title={e.tle_fetched_at || ""}>{fmtDT(e.tle_fetched_at)}</TableCell>
                      <TableCell>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: "monospace", wordBreak: "break-all", display: "block" }}
                        >
                          {e.tle1}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: "monospace", wordBreak: "break-all", display: "block" }}
                        >
                          {e.tle2}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {entriesState && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              共 {entriesState.count} 条
            </Typography>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
