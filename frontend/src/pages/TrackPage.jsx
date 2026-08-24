import React, { useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import { useDispatch, useSelector } from "react-redux";
import { useSocket } from "../hooks/useSocket.js";
import ControlBar from "../components/ControlBar.jsx";
import PassList from "../components/PassList.jsx";
import PolarChart from "../components/PolarChart.jsx";
import GroundTrack from "../components/GroundTrack.jsx";
import {
  loadPasses,
  updateParams,
  setActiveIdx,
  toggleCompactSidebar,
  toggleSidebar,
  DEFAULT_PARAMS,
} from "../slices/trackSlice.js";
import { loadSettings, persistSettings } from "../slices/settingsSlice.js";

// 卫星轨迹页：状态统一由 Redux（track slice）管理，外层布局由 AppShell 提供
export default function TrackPage() {
  const dispatch = useDispatch();
  const params = useSelector((s) => s.track.params);
  const data = useSelector((s) => s.track.data);
  const loading = useSelector((s) => s.track.loading);
  const error = useSelector((s) => s.track.error);
  const activeIdx = useSelector((s) => s.track.activeIdx);
  const currentPos = useSelector((s) => s.track.currentPos);
  const socketStatus = useSelector((s) => s.track.socketStatus);
  const compactSidebar = useSelector((s) => s.track.compactSidebar);
  const sidebarVisible = useSelector((s) => s.track.sidebarVisible);
  const savedSettings = useSelector((s) => s.settings.values);

  // 首次加载：先从后端读取持久化设置作为初始参数，再拉取过境数据
  useEffect(() => {
    const init = async () => {
      let initParams = DEFAULT_PARAMS;
      try {
        const res = await dispatch(loadSettings());
        const s = res.payload;
        if (s) {
          initParams = {
            lat: s.lat ?? DEFAULT_PARAMS.lat,
            lon: s.lon ?? DEFAULT_PARAMS.lon,
            alt: s.alt ?? DEFAULT_PARAMS.alt,
            satellite: s.satellite ?? DEFAULT_PARAMS.satellite,
            hours: s.hours ?? DEFAULT_PARAMS.hours,
            sample_interval: s.sample_interval ?? DEFAULT_PARAMS.sample_interval,
          };
        }
      } catch (e) {
        // 后端设置读取失败时回退到默认参数
      }
      dispatch(updateParams(initParams));
      dispatch(loadPasses(initParams));
    };
    init();
  }, [dispatch]);

  // Socket.IO：实时接收当前站点配置与卫星当前位置，并同步连接状态（断线/重连提示）。
  // 连接建立、事件分发与清理均封装在 useSocket Hook 中。
  useSocket();

  // 重新计算（用当前表单参数）
  const recalc = useCallback(() => {
    dispatch(loadPasses(params));
  }, [dispatch, params]);

  // 自动保存：控制栏参数（卫星/站点/时长/采样）变更后防抖 800ms 写入后端。
  // 设置加载完成前不保存，且与后端持久化值一致时不触发，避免启动时的无意义写入。
  useEffect(() => {
    if (!savedSettings) return;
    const same =
      savedSettings.lat === params.lat &&
      savedSettings.lon === params.lon &&
      savedSettings.alt === params.alt &&
      savedSettings.satellite === params.satellite &&
      savedSettings.hours === params.hours &&
      savedSettings.sample_interval === params.sample_interval;
    if (same) return;
    const id = setTimeout(() => {
      dispatch(
        persistSettings({
          lat: params.lat,
          lon: params.lon,
          alt: params.alt,
          satellite: params.satellite,
          hours: params.hours,
          sample_interval: params.sample_interval,
        })
      );
    }, 800);
    return () => clearTimeout(id);
  }, [
    params.lat, params.lon, params.alt, params.satellite,
    params.hours, params.sample_interval, savedSettings, dispatch,
  ]);

  const activePass = data && data.passes ? data.passes[activeIdx] : null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ControlBar
        params={params}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => dispatch(toggleSidebar())}
        onChange={(next) => {
          dispatch(updateParams(next));
          if (next.satellite !== params.satellite) {
            dispatch(loadPasses(next));
          }
        }}
        onRecalc={recalc}
        loading={loading}
      />

      {error && (
        <Box sx={{ p: 3, textAlign: "center", color: "#f87171", fontSize: 13 }}>加载失败：{error}</Box>
      )}
      {!data && !error && (
        <Box sx={{ p: 3, textAlign: "center", color: "text.secondary", fontSize: 13 }}>
          加载中…（正在计算卫星过境，请稍候）
        </Box>
      )}
      {data && data.passes && data.passes.length === 0 && !loading && (
        <Box sx={{ p: 3, textAlign: "center", color: "#f87171", fontSize: 13 }}>
          所选卫星在当前时段内无可见过境，可尝试增大时长或更换地面站
        </Box>
      )}

      {/* TLE 来源透明提示：在线源全部失败时后端回退到内置历史 TLE（可能过时） */}
      {data && data.tle_source === "fallback" && (
        <Alert severity="warning" sx={{ mx: 1.5, mt: 1 }}>
          当前轨道数据来自内置历史 TLE（在线获取失败），可能已过时，建议在设置页手动更新轨道数据
        </Alert>
      )}

      {/* Socket.IO 断线提示：连接中断时 socket.io 会自动重连 */}
      {socketStatus === "disconnected" && (
        <Alert severity="warning" sx={{ mx: 1.5, mt: 1 }}>
          实时连接已断开，正在自动重连…
        </Alert>
      )}

      {data && (
        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 2,
            p: 1.5,
            overflow: "auto",
            // 桌面端：左栏过境列表 + 右栏地图（compact 收窄左栏；隐藏侧栏时地图占满）
            "@media (min-width: 1100px)": {
              gridTemplateColumns: sidebarVisible
                ? compactSidebar
                  ? "280px 1fr"
                  : "520px 1fr"
                : "1fr",
              overflow: "hidden",
            },
          }}
        >
          {/* 左栏：过境列表（上）+ 极坐标图（下），可通过工具栏开关隐藏 */}
          {sidebarVisible && (
            <Box
              component="aside"
              sx={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 1.5, overflow: "hidden" }}
            >
              <PassList
                passes={data.passes}
                activeIdx={activeIdx}
                onSelect={(i) => dispatch(setActiveIdx(i))}
                compact={compactSidebar}
                onToggleCompact={() => dispatch(toggleCompactSidebar())}
              />
              <Box
                sx={{
                  flex: "0 0 calc(50% - 6px)",
                  minHeight: 0,
                  bgcolor: "var(--panel)",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: "8px",
                  p: 1.25,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <PolarChart pass={activePass} currentPos={currentPos} compact={compactSidebar} />
              </Box>
            </Box>
          )}

          {/* 右栏：卫星轨迹（2D/3D）独占；移动端单列时保证地图至少 320px 高 */}
          <Box
            component="section"
            sx={{
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              "@media (max-width: 1099px)": { minHeight: 320 },
            }}
          >
            <GroundTrack params={params} passes={data.passes} activeIdx={activeIdx} onSelect={(i) => dispatch(setActiveIdx(i))} activePass={activePass} currentPos={currentPos} sidebarVisible={sidebarVisible} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
