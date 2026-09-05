import React, { useEffect, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import AppShell from "./layout/AppShell.jsx";
import TrackPage from "./pages/TrackPage.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { createAppTheme, applyThemeCssVars } from "./theme.js";
import { loadSettings } from "./slices/settingsSlice.js";

// 次级页面路由级懒加载：卫星管理 / 3D 运行态势 / 系统配置各自成块，仅导航到时才下载，
// 首屏（/track）不加载它们的代码及其独有依赖（如 3D 态势页的 satellite.js / MultiGlobe）。
// TrackPage 为落地路由，保持同步加载避免首屏 fallback 闪烁；Suspense 边界见 AppShell 的 Outlet。
const SatellitePage = lazy(() => import("./pages/SatellitePage.jsx"));
const Satellites3DPage = lazy(() => import("./pages/Satellites3DPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));

// 根据 Redux 设置中的 theme 字段动态生成主题，并同步自定义 CSS 变量
function ThemedApp() {
  const dispatch = useDispatch();
  const themeMode = useSelector((s) => s.settings.values?.theme || "dark");

  // 启动即加载持久化设置（坐标/卫星/站点/主题），供轨迹页与设置页共用
  useEffect(() => {
    dispatch(loadSettings());
  }, [dispatch]);

  useEffect(() => {
    applyThemeCssVars(themeMode);
  }, [themeMode]);

  return (
    <ThemeProvider theme={createAppTheme(themeMode)}>
      <CssBaseline />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/track" replace />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/satellites" element={<SatellitePage />} />
          <Route path="/satellites3d" element={<Satellites3DPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/track" replace />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}

// 路由配置：AppShell 提供全局布局（标题栏 + 侧边菜单），子路由对应各功能页面
export default function App() {
  return (
    <ErrorBoundary>
      <ThemedApp />
    </ErrorBoundary>
  );
}
