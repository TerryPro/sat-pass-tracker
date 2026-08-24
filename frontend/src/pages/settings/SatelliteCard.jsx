// 卫星管理卡片：卫星表格 + 从网络导入 + 查看信息 + 单颗/批量轨道数据更新。
// 导入对话框、信息对话框及其全部状态在本地维护，自行调用 API 与 Redux；
// 仅通过回调与父级交互：错误/成功提示（onError/onNotice/onSaved）与表格刷新（onReload）。
import React, { useState } from "react";
import { useDispatch } from "react-redux";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Radio from "@mui/material/Radio";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import InfoIcon from "@mui/icons-material/Info";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  searchSatellites,
  fetchSatelliteDetail,
  fetchSatelliteInfo,
  refreshSatellite,
  refreshAllSatellites,
} from "../../api";
import { importSatellite, deleteSatellite } from "../../slices/settingsSlice.js";
import { ORBIT_LABELS, STATUS_LABEL } from "../../constants.js";
import { CardTitle, InfoGrid } from "./parts.jsx";
import { dedupeFreqs, fmtDate, fmtDT } from "./helpers.js";

export default function SatelliteCard({
  satellites,
  satList,
  onError,
  onNotice,
  onSaved,
  onReload,
}) {
  const dispatch = useDispatch();
  // 卫星导入对话框：名称/NORAD 搜索 → 选择结果 → 导入
  const [satDlg, setSatDlg] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedSat, setSelectedSat] = useState(null);
  const [importing, setImporting] = useState(false);
  // 卫星详情对话框：infoSat 为查看的卫星，info 为接口返回的详情，satInfo 为介绍/频率
  const [infoSat, setInfoSat] = useState(null);
  const [info, setInfo] = useState(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [satInfo, setSatInfo] = useState(null);
  const [satInfoLoading, setSatInfoLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);

  // ---- 卫星表格 ----
  // 优先展示带 TLE 时间信息的列表，拉取失败时回退到基础卫星数据
  const tableSats = satList.length > 0 ? satList : satellites;

  // ---- 导入对话框 ----
  // 打开导入对话框并重置搜索状态
  const openImportDlg = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedSat(null);
    setSatDlg(true);
  };

  // 按名称或 NORAD 目录号搜索卫星候选
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    onError("");
    setSearching(true);
    setSelectedSat(null);
    try {
      const res = await searchSatellites(q);
      setSearchResults(res.results || []);
      // 仅一个匹配时直接选中，减少点击
      if (res.results && res.results.length === 1) setSelectedSat(res.results[0]);
    } catch (e) {
      onError(e.message || "搜索失败");
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // 导入选中的卫星（从网络获取 TLE 验证后入库）
  const handleImportSatellite = async () => {
    if (!selectedSat) return;
    onError("");
    setImporting(true);
    try {
      await dispatch(importSatellite(String(selectedSat.norad_id))).unwrap();
      onNotice(`卫星“${selectedSat.name}”导入成功`);
      setSatDlg(false);
      setSearchQuery("");
      setSearchResults([]);
      setSelectedSat(null);
      onReload();
    } catch (e) {
      // unwrap 抛出的可能是字符串（rejectWithValue），需兼容透传后端错误信息
      onError(typeof e === "string" ? e : e?.message || "导入失败");
    } finally {
      setImporting(false);
    }
  };

  // ---- 信息对话框 ----
  // 删除自定义卫星（内置卫星不可删除）
  const handleDeleteSatellite = async (id) => {
    onError("");
    try {
      await dispatch(deleteSatellite(id)).unwrap();
      onSaved(true);
      onReload();
    } catch (e) {
      onError(typeof e === "string" ? e : e?.message || "删除失败");
    }
  };

  // 查看卫星详情：基本信息 + 轨道根数 + TLE 原文 + 介绍/频率（并行拉取）
  const showSatelliteInfo = async (sat) => {
    setInfoSat(sat);
    setInfo(null);
    setSatInfo(null);
    setInfoLoading(true);
    setSatInfoLoading(true);
    try {
      const [detail, infoData] = await Promise.all([
        fetchSatelliteDetail(sat.id),
        fetchSatelliteInfo(sat.id).catch(() => null), // 介绍/频率失败不阻塞详情
      ]);
      setInfo(detail);
      setSatInfo(infoData ? { ...infoData, frequencies: dedupeFreqs(infoData.frequencies || []) } : null);
    } catch (e) {
      onError(e.message || "获取卫星信息失败");
    } finally {
      setInfoLoading(false);
      setSatInfoLoading(false);
    }
  };

  // 手动刷新卫星轨道数据（从网络更新 TLE）
  const handleRefresh = async () => {
    if (!infoSat) return;
    onError("");
    setRefreshing(true);
    try {
      setInfo(await refreshSatellite(infoSat.id));
      onSaved(true);
    } catch (e) {
      onError(e.message || "刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  // 批量手动更新全部卫星的轨道数据
  const handleRefreshAll = async () => {
    onError("");
    setRefreshingAll(true);
    try {
      const res = await refreshAllSatellites();
      onNotice(
        `轨道数据更新完成：${res.updated} 颗成功${res.failed > 0 ? `，${res.failed} 颗失败` : ""}`
      );
      onReload();
    } catch (e) {
      onError(e.message || "更新失败");
    } finally {
      setRefreshingAll(false);
    }
  };

  return (
    <>
      <Paper sx={{ p: 2.5 }}>
        <CardTitle
          title="卫星管理"
          hint="内置卫星不可删除；按 NORAD 目录号从网络导入需要预测的卫星"
        />
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow>
                <TableCell>名称</TableCell>
                <TableCell align="right">NORAD ID</TableCell>
                <TableCell align="right">更新时间</TableCell>
                <TableCell align="right">轨道时间</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tableSats.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell>{s.name}</TableCell>
                  <TableCell align="right">{s.norad_id}</TableCell>
                  <TableCell align="right" title={s.fetched_at || ""}>{fmtDT(s.fetched_at)}</TableCell>
                  <TableCell align="right" title={s.epoch || ""}>{fmtDT(s.epoch)}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      aria-label={`信息 ${s.name}`}
                      title="查看卫星信息"
                      onClick={() => showSatelliteInfo(s)}
                    >
                      <InfoIcon fontSize="small" />
                    </IconButton>
                    {!s.builtin ? (
                      <IconButton
                        size="small"
                        aria-label={`删除 ${s.name}`}
                        onClick={() => handleDeleteSatellite(s.id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        内置
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="small" variant="outlined" startIcon={<CloudDownloadIcon />} onClick={openImportDlg}>
            从网络导入
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefreshAll}
            disabled={refreshingAll}
            title="从网络批量更新全部卫星的轨道数据"
          >
            {refreshingAll ? "更新中…" : "手动更新"}
          </Button>
        </Box>
      </Paper>

      {/* 导入卫星对话框（名称/NORAD 搜索 → 选择 → 导入） */}
      <Dialog open={satDlg} onClose={() => setSatDlg(false)} fullWidth maxWidth="sm">
        <DialogTitle>从网络导入卫星</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            输入卫星名称或 NORAD 目录号搜索（如 ISS、NOAA、33591），从结果中选择要导入的卫星。
          </Typography>
          <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
            <TextField
              label="卫星名称 / NORAD 目录号"
              size="small"
              fullWidth
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              autoFocus
            />
            <Button variant="contained" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
              {searching ? "搜索中…" : "搜索"}
            </Button>
          </Box>
          {searchResults.length > 0 && (
            <List
              dense
              disablePadding
              sx={{
                maxHeight: 280,
                overflow: "auto",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
              }}
            >
              {searchResults.map((r) => (
                <ListItem key={r.norad_id} disableGutters disablePadding>
                  <ListItemButton
                    dense
                    selected={selectedSat?.norad_id === r.norad_id}
                    onClick={() => setSelectedSat(r)}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <Radio checked={selectedSat?.norad_id === r.norad_id} size="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={r.name}
                      secondary={`NORAD ${r.norad_id}`}
                      slotProps={{
                        primary: { variant: "body2" },
                        secondary: { variant: "caption" },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSatDlg(false)}>取消</Button>
          <Button variant="contained" onClick={handleImportSatellite} disabled={importing || !selectedSat}>
            {importing ? "导入中…" : "导入所选卫星"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 卫星信息对话框 */}
      <Dialog open={!!infoSat} onClose={() => setInfoSat(null)} fullWidth maxWidth="md">
        {infoLoading ? (
          <DialogContent>
            <Typography variant="body2" color="text.secondary">加载中…</Typography>
          </DialogContent>
        ) : info ? (
          <>
            <DialogTitle sx={{ pb: 1 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
                <Box>
                  {/* 标题用卫星列表中的名称（刷新后 TLE 名称变化不应影响显示名） */}
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>{infoSat?.name || info.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    NORAD {info.norad_id} · {info.builtin ? "内置卫星" : "自定义卫星"}
                    {info.tle_name ? ` · TLE 名称：${info.tle_name}` : ""}
                  </Typography>
                </Box>
                {satInfo?.status && (
                  <Chip
                    size="small"
                    label={STATUS_LABEL[satInfo.status] || satInfo.status}
                    color={satInfo.status === "alive" ? "success" : satInfo.status === "dead" ? "error" : "default"}
                    variant="outlined"
                  />
                )}
              </Box>
            </DialogTitle>
            <DialogContent dividers>
              {/* 分区 1：基本信息 */}
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>基本信息</Typography>
              <InfoGrid
                fields={[
                  ["国际编号", info.orbit?.cospar],
                  ["轨道类型", info.orbit?.orbit_class],
                  ["数据更新时间", info.fetched_at ? new Date(info.fetched_at).toLocaleString("zh-CN") : ""],
                  ["别名", satInfo?.names],
                  ["发射日期", fmtDate(satInfo?.launch_date)],
                  ["所属国家", satInfo?.countries],
                  ["遥测解码器", satInfo?.telemetries?.join("、")],
                  ["官网", satInfo?.website],
                ]}
                linkKeys={["官网"]}
              />
              <Divider sx={{ my: 2 }} />
              {/* 分区 2：轨道参数 */}
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>轨道参数</Typography>
              <InfoGrid fields={Object.entries(ORBIT_LABELS).map(([key, label]) => [label, info.orbit?.[key]])} />
              <Divider sx={{ my: 2 }} />
              {/* 分区 3：频率信息 */}
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                频率信息{satInfo?.frequencies?.length ? "（业余无线电）" : ""}
              </Typography>
              {satInfoLoading ? (
                <Typography variant="body2" color="text.secondary">加载频率信息…</Typography>
              ) : satInfo && satInfo.frequencies && satInfo.frequencies.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>上行 (MHz)</TableCell>
                        <TableCell>下行 (MHz)</TableCell>
                        <TableCell>信标 (MHz)</TableCell>
                        <TableCell>模式</TableCell>
                        <TableCell>呼号</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {satInfo.frequencies.map((f, i) => (
                        <TableRow key={i}>
                          <TableCell>{f.uplink || "—"}</TableCell>
                          <TableCell>{f.downlink || "—"}</TableCell>
                          <TableCell>{f.beacon || "—"}</TableCell>
                          <TableCell>{f.mode || "—"}</TableCell>
                          <TableCell>{f.callsign || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">暂无频率信息</Typography>
              )}
              <Divider sx={{ my: 2 }} />
              {/* 分区 4：TLE 原始数据 */}
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>TLE 原始数据</Typography>
              <Typography
                variant="caption"
                sx={{ fontFamily: "monospace", wordBreak: "break-all", display: "block", lineHeight: 1.6 }}
              >
                {info.tle1}
                <br />
                {info.tle2}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setInfoSat(null)}>关闭</Button>
              <Button variant="contained" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? "刷新中…" : "刷新轨道数据"}
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
