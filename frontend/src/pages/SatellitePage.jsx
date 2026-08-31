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
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import DownloadIcon from "@mui/icons-material/Download";
import SearchIcon from "@mui/icons-material/Search";
import ArticleIcon from "@mui/icons-material/Article";
import PublicIcon from "@mui/icons-material/Public";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
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
import { fetchLibraryDetail, fetchLibraryInfo, activateSatellite, deactivateSatellite } from "../api/library.js";
import { fetchSatellites, refreshSatellite, refreshAllSatellites } from "../api";
import { ORBIT_LABELS } from "../constants.js";

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
  // 弹窗：currentNorad 为当前查看的星；orbitOpen 轨道弹窗，infoOpen 档案弹窗
  const [detailNorad, setDetailNorad] = useState(null);   // 当前查看的星 norad
  const [orbitOpen, setOrbitOpen] = useState(false);       // 轨道信息弹窗
  const [infoOpen, setInfoOpen] = useState(false);         // 卫星档案信息弹窗
  const [detail, setDetail] = useState(null);             // 轨道数据(轨道根数 + TLE)
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  // 档案信息(SatNOGS + AMSAT)状态
  const [info, setInfo] = useState(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState("");
  const [infoRefreshing, setInfoRefreshing] = useState(false);
  // 已加入列表（配置页卫星管理表格共用数据源 settings.satellites）
  const [joined, setJoined] = useState([]);
  const [joinedLoading, setJoinedLoading] = useState(false);
  const [joinedError, setJoinedError] = useState("");

  // 请求竞态防护：递增序号，store 只采纳最新的（latest-wins）
  const reqSeqRef = useRef(0);
  const nextSeq = () => ++reqSeqRef.current;

  // 页面挂载：加载数据源元信息与已加入列表；条目等用户选中某个组后再加载
  useEffect(() => {
    dispatch(loadLibraryMeta());
    loadJoined();
  }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // 加载"已加入"列表（配置页卫星表格同源，含 TLE 更新时间/历元）
  const loadJoined = async () => {
    setJoinedLoading(true);
    setJoinedError("");
    try {
      const res = await fetchSatellites();
      setJoined(res.satellites || []);
    } catch (e) {
      setJoinedError(e.message || "加载已加入卫星失败");
    } finally {
      setJoinedLoading(false);
    }
  };

  // 把库内某星加入已加入列表
  const handleActivate = async (noradId) => {
    try {
      await activateSatellite(noradId);
      await loadJoined();
    } catch (e) {
      setJoinedError(e.message || "加入失败");
    }
  };

  // 从已加入列表移除（内置星后端会拒绝）
  const handleDeactivate = async (id) => {
    try {
      await deactivateSatellite(id);
      await loadJoined();
    } catch (e) {
      setJoinedError(e.message || "移除失败");
    }
  };

  // 刷新轨道数据（TLE）：单颗 / 全部，从网络重新拉取并持久化（原设置页卫星卡片功能迁移至此）
  const [refreshingId, setRefreshingId] = useState(null); // 正在刷新的 norad
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [joinedNotice, setJoinedNotice] = useState("");   // 成功提示（短暂显示）

  const showJoinedNotice = (msg) => {
    setJoinedNotice(msg);
    setTimeout(() => setJoinedNotice(""), 3000);
  };

  const handleRefresh = async (noradId) => {
    setRefreshingId(noradId);
    setJoinedError("");
    try {
      await refreshSatellite(noradId);
      await loadJoined();
      showJoinedNotice("轨道数据已更新");
    } catch (e) {
      setJoinedError(e.message || "刷新轨道数据失败");
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    setJoinedError("");
    try {
      const res = await refreshAllSatellites();
      await loadJoined();
      showJoinedNotice(`轨道数据更新完成：${res.updated} 颗成功${res.failed > 0 ? `，${res.failed} 颗失败` : ""}`);
    } catch (e) {
      setJoinedError(e.message || "批量更新失败");
    } finally {
      setRefreshingAll(false);
    }
  };

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

  // 打开「轨道信息」弹窗（轨道根数从 TLE 解析，离线）
  const openOrbit = async (noradId) => {
    setDetailNorad(noradId);
    setOrbitOpen(true);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      setDetail(await fetchLibraryDetail(noradId));
    } catch (e) {
      setDetailError(e.message || "获取轨道信息失败");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };
  const closeOrbit = () => setOrbitOpen(false);

  // 打开「卫星档案信息」弹窗（SatNOGS + AMSAT；本地缓存，可强制刷新）
  const openInfo = async (noradId) => {
    setDetailNorad(noradId);
    setInfoOpen(true);
    await loadInfo(noradId, false);
  };
  const closeInfo = () => setInfoOpen(false);

  // 加载/刷新档案信息（refresh=True 强制联网更新缓存）
  const loadInfo = async (noradId, refresh) => {
    setInfo(null);
    setInfoError("");
    setInfoLoading(true);
    setInfoRefreshing(refresh);
    try {
      const res = await fetchLibraryInfo(noradId, refresh);
      setInfo(res);
    } catch (e) {
      setInfoError(e.message || "获取档案信息失败");
      setInfo(null);
    } finally {
      setInfoLoading(false);
      setInfoRefreshing(false);
    }
  };

  const handleRefreshInfo = () => {
    if (detailNorad != null) loadInfo(detailNorad, true);
  };

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
      {/* 左右分栏：左=数据源(窄)，右=已下载数据浏览 */}
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, flex: 1, minHeight: 0 }}>
        {/* 数据源面板（左，较窄）：下载/更新各组的原始 TLE 文件 */}
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
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            在所选数据源中浏览卫星，可查看轨道与档案信息
          </Typography>
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
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {searching && displayEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      <Typography variant="body2" color="text.secondary">搜索中…</Typography>
                    </TableCell>
                  </TableRow>
                ) : displayEntries.length === 0 ? (
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
                  displayEntries.map((e) => (
                    <TableRow key={e.norad_id} hover>
                      <TableCell>{e.name}</TableCell>
                      <TableCell align="right">{e.norad_id}</TableCell>
                      <TableCell align="right">
                        {joined.some((j) => Number(j.norad_id) === Number(e.norad_id)) ? (
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
                            onClick={() => handleActivate(e.norad_id)}
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
                          onClick={() => openOrbit(e.norad_id)}
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
                          onClick={() => openInfo(e.norad_id)}
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
          {entriesState && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              共 {entriesState.count} 条
            </Typography>
          )}
        </Paper>

        {/* 已加入卫星（配置页"卫星管理"表格同源；本页可从数据源浏览列点「加入」添加） */}
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
                onClick={handleRefreshAll}
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
                        <IconButton size="small" title="轨道信息" onClick={() => openOrbit(Number(j.norad_id))} sx={{ color: "primary.main", bgcolor: "rgba(25,118,210,0.12)", "&:hover": { bgcolor: "primary.main", color: "#fff" } }}>
                          <PublicIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" title="卫星信息" onClick={() => openInfo(Number(j.norad_id))} sx={{ color: "primary.main", bgcolor: "rgba(25,118,210,0.12)", "&:hover": { bgcolor: "primary.main", color: "#fff" } }}>
                          <ArticleIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          title="刷新轨道数据"
                          onClick={() => handleRefresh(Number(j.norad_id))}
                          disabled={refreshingId === j.norad_id}
                          sx={{ color: "success.main", bgcolor: "rgba(76,175,80,0.12)", "&:hover": { bgcolor: "success.main", color: "#fff" } }}
                        >
                          <RefreshIcon fontSize="small" />
                        </IconButton>
                        {!j.builtin && (
                          <IconButton
                            size="small"
                            title="移除"
                            onClick={() => handleDeactivate(j.id)}
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
      </Box>

      {/* 轨道信息弹窗：从 TLE 解析的轨道根数 + TLE 原文 */}
      <Dialog open={orbitOpen} onClose={closeOrbit} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 1 }}>
          {detail?.name || ""}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            NORAD {detail?.norad_id ?? detailNorad} · {detail?.source || ""}
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
          <Button onClick={closeOrbit}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 卫星档案信息弹窗：SatNOGS 基本信息 + AMSAT 频率（本地缓存，可强制刷新） */}
      <Dialog open={infoOpen} onClose={closeInfo} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 1 }}>
          卫星信息
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            NORAD {detailNorad}
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
          <Button onClick={closeInfo}>关闭</Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefreshInfo}
            disabled={infoLoading || infoRefreshing}
          >
            {infoRefreshing ? "刷新中…" : "强制刷新档案"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
