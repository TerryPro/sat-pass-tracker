// 卫星组 3D 运行状态页：选择一个数据源组，用 Cesium 在浏览器端展示该组全部卫星
// 的星下点分布 + 时间推进（SGP4 由 satellite.js 在本地计算，见 sat/satmath.mjs）。
// 复用 globe3d 的 viewer 工厂与 Cesium 懒加载；渲染由 MultiGlobe 承担。
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ReplayIcon from "@mui/icons-material/Replay";
import { useDispatch, useSelector } from "react-redux";
import { loadLibraryMeta } from "../slices/librarySlice.js";
import { fetchLibraryEntries } from "../api/library.js";
import { buildSatRecords, eciPositionsAtTime, sampleEci, subpoint } from "../sat/satmath.mjs";
import MultiGlobe from "../components/globe3d/MultiGlobe.jsx";

const MAX_ORBIT = 40;        // 最多给前 N 颗星画轨道线（性能）
const STEP_MS = 500;         // 播放每帧间隔
const PLAY_RATES = [1, 5, 15, 30, 60, 120]; // 播放倍速选项

function fmtHMS(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} UTC`;
}

export default function Satellites3DPage() {
  const dispatch = useDispatch();
  const meta = useSelector((s) => s.library.meta);
  const [group, setGroup] = useState("");
  const [records, setRecords] = useState([]);       // [{norad,name,satrec}]
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playedDate, setPlayedDate] = useState(() => new Date());
  const [playing, setPlaying] = useState(false);
  const [playRate, setPlayRate] = useState(5); // 播放倍速（每秒推进基准秒数 × 倍率）
  const [selectedNorad, setSelectedNorad] = useState(null);
  const [selectedInfo, setSelectedInfo] = useState(null);

  const ledateRef = useRef(new Date());
  ledateRef.current = playedDate;

  useEffect(() => {
    dispatch(loadLibraryMeta());
  }, [dispatch]);

  const downloadedGroups = useMemo(() => (meta?.groups || []).filter((g) => g.downloaded), [meta]);

  // 当前时刻全组卫星的 ECI 位置（每次播放推进 / 组变化时重算）
  const [positions, setPositions] = useState([]);
  // 轨道线数据（前 MAX_ORBIT 颗，ECI 序列）
  const [orbits, setOrbits] = useState([]);

  // 重建计算：对 records 在某个时刻重新算 ECI 位置 + 轨道线
  const computeAt = useCallback((recs, date, withOrbits) => {
    const pts = eciPositionsAtTime(recs, date, 0); // 0=不截断（全组）
    setPositions(pts.filter((p) => p.isValid));
    if (withOrbits) {
      const start = new Date(date.getTime() - 45 * 60 * 1000);
      const orbs = recs.slice(0, MAX_ORBIT).map((s) => {
        const path = sampleEci(s, start, 90, 120); // 90min / 120s
        if (path.length < 2) return null;
        return { norad: s.norad, name: s.name, path };
      }).filter(Boolean);
      setOrbits(orbs);
    }
  }, []);

  // 载入选中的组
  const handleGroup = async (key) => {
    const g = downloadedGroups.find((x) => x.key === key);
    setGroup(key);
    setError("");
    setLoading(true);
    setPlaying(false);
    try {
      const res = await fetchLibraryEntries({ source: key });
      const r = buildSatRecords(res.entries || []);
      if (!r.length) { setError("该组没有可解析的卫星 TLE"); return; }
      setRecords(r);
      setGroupName(g ? g.label : key);
      const now = new Date();
      setPlayedDate(now);
      computeAt(r, now, true);
    } catch (e) {
      setError(e.message || "加载组数据失败");
    } finally {
      setLoading(false);
    }
  };

  // 播放推进：每 tick 按倍速把 playedDate 前进，并按最新时刻重算卫星位置（全组）
  useEffect(() => {
    if (!playing) return;
    const deltaSec = playRate * STEP_MS / 1000; // 每 tick 推进的模拟秒数
    const id = setInterval(() => {
      const next = new Date(ledateRef.current.getTime() + deltaSec * 1000);
      setPlayedDate(next);
      computeAt(records, next, false); // 播放时卫星移动，轨道线保持
    }, STEP_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, records, playRate]);

  // 选中星信息：从 records 取到 satrec，按当前显示时刻算星下点
  useEffect(() => {
    if (selectedNorad == null) { setSelectedInfo(null); return; }
    const s = records.find((x) => x.norad === selectedNorad);
    if (!s) { setSelectedInfo(null); return; }
    const p = subpoint(s, playedDate);
    setSelectedInfo(p && p.isValid ? p : null);
  }, [selectedNorad, playedDate, records]);

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* 顶部控制栏 */}
      <Paper sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flexShrink: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>卫星组 3D 运行</Typography>
        <Select
          size="small"
          displayEmpty
          value={group}
          onChange={(e) => handleGroup(e.target.value)}
          sx={{ minWidth: 200 }}
          renderValue={(v) => {
            if (!v) return <Typography variant="body2" color="text.secondary">选择数据源组…</Typography>;
            const g = downloadedGroups.find((x) => x.key === v);
            return g ? g.label : v;
          }}
        >
          {downloadedGroups.length === 0 && <MenuItem value="" disabled>暂无已下载的组</MenuItem>}
          {downloadedGroups.map((g) => (
            <MenuItem key={g.key} value={g.key}>{g.label}（{g.count}）</MenuItem>
          ))}
        </Select>

        {records.length > 0 && (
          <>
            <Button
              size="small"
              variant="outlined"
              startIcon={playing ? <PauseIcon /> : <PlayArrowIcon />}
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? "暂停" : "播放"}
            </Button>
            <Select
              size="small"
              value={playRate}
              onChange={(e) => setPlayRate(Number(e.target.value))}
              sx={{ minWidth: 90 }}
              title="播放倍速"
            >
              {PLAY_RATES.map((r) => (
                <MenuItem key={r} value={r}>{r}×</MenuItem>
              ))}
            </Select>
            <Button size="small" startIcon={<ReplayIcon />} onClick={() => { setPlaying(false); setPlayedDate(new Date()); }}>
              回到当前
            </Button>
          </>
        )}

        {records.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: "auto", textAlign: "right" }}>
            组内 {records.length} 颗 · 显示时刻 <b>{fmtHMS(playedDate)}</b>
            {selectedInfo ? (
              <Box component="span" sx={{ display: "block" }}>
                选中 <b>{selectedInfo.name}</b>（NORAD {selectedInfo.norad}）· 星下点{" "}
                {selectedInfo.lat.toFixed(2)}°, {selectedInfo.lon.toFixed(2)}° · 高{" "}
                {Math.round(selectedInfo.altKm)} km
              </Box>
            ) : null}
          </Typography>
        )}
      </Paper>

      {error && <Alert severity="error" size="small" onClose={() => setError("")}>{error}</Alert>}

      {/* 3D 地球：全组星下点 + 前 N 颗轨道线 */}
      <Paper sx={{ flex: 1, minHeight: 0, display: "flex", p: 0 }}>
        {loading ? (
          <Box sx={{ m: "auto", color: "text.secondary", fontSize: 13 }}>加载组数据并计算星下点…</Box>
        ) : records.length === 0 ? (
          <Box sx={{ m: "auto", color: "text.secondary", fontSize: 13 }}>
            请在上方选择一个数据源组，查看该组卫星的实时运行状态。
          </Box>
        ) : (
          <MultiGlobe
            positions={positions}
            orbits={orbits}
            displayDate={playedDate}
            highlightNorad={selectedNorad}
            onPickNorad={setSelectedNorad}
            active
          />
        )}
      </Paper>
    </Box>
  );
}
