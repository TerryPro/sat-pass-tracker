// 卫星管理页：数据源文件管理 + 本地卫星库数据浏览 + 已加入卫星管理。
//   - 数据源面板：从 CelesTrak 组下载常用卫星 TLE 文件，本地持久化（后台管理）。
//   - 数据浏览：查看已下载原始文件解析出的卫星（名称/NORAD 搜索），可加入/查看轨道档案。
//   - 已加入卫星：查看轨道/档案、刷新轨道数据、移除。
// 本页仅负责状态编排与数据加载，各面板/弹窗为独立子组件（pages/satellite/）。
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
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
import SourcePanel from "./satellite/SourcePanel.jsx";
import BrowserTable from "./satellite/BrowserTable.jsx";
import JoinedPanel from "./satellite/JoinedPanel.jsx";
import OrbitDialog from "./satellite/OrbitDialog.jsx";
import InfoDialog from "./satellite/InfoDialog.jsx";

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

  // 刷新轨道数据（TLE）：单颗 / 全部，从网络重新拉取并持久化
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
  const entriesCount = entriesState ? entriesState.count : -1;

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

  // 打开「卫星档案信息」弹窗（SatNOGS + AMSAT；本地缓存，可强制刷新）
  const openInfo = async (noradId) => {
    setDetailNorad(noradId);
    setInfoOpen(true);
    await loadInfo(noradId, false);
  };

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
      {/* 左右分栏：左=数据源(窄)，中=已下载数据浏览，右=已加入卫星 */}
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, flex: 1, minHeight: 0 }}>
        <SourcePanel
          categories={categories}
          downloadingKey={downloadingKey}
          error={error}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
          onDownload={handleDownload}
          onDismissError={() => dispatch(clearLibraryError())}
        />
        <BrowserTable
          entries={displayEntries}
          count={entriesCount}
          searching={searching}
          joined={joined}
          groupEmpty={groupEmpty}
          q={q}
          downloadedGroups={downloadedGroups}
          selectedGroup={selectedGroup}
          onSearchChange={setQ}
          onSelectGroup={setSelectedGroup}
          onActivate={handleActivate}
          onOpenOrbit={openOrbit}
          onOpenInfo={openInfo}
        />
        <JoinedPanel
          joined={joined}
          joinedLoading={joinedLoading}
          joinedError={joinedError}
          joinedNotice={joinedNotice}
          refreshingAll={refreshingAll}
          refreshingId={refreshingId}
          onRefreshAll={handleRefreshAll}
          onRefresh={handleRefresh}
          onDeactivate={handleDeactivate}
          onOpenOrbit={openOrbit}
          onOpenInfo={openInfo}
        />
      </Box>

      <OrbitDialog
        open={orbitOpen}
        onClose={() => setOrbitOpen(false)}
        noradId={detailNorad}
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
      />
      <InfoDialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        noradId={detailNorad}
        info={info}
        infoLoading={infoLoading}
        infoError={infoError}
        infoRefreshing={infoRefreshing}
        onRefreshInfo={handleRefreshInfo}
      />
    </Box>
  );
}
