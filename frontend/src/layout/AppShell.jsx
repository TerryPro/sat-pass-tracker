import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { getNavigation } from "../config/navigation.jsx";
import { APP_VERSION } from "../version.js";

const DRAWER_EXPANDED = 240;
const DRAWER_COLLAPSED = 56;

// 当前时间格式化：utc → UTC 时间；local → 本地时间
function fmtNow(date, mode = "utc") {
  const p = (n) => String(n).padStart(2, "0");
  if (mode === "local") {
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())} 本地`;
  }
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} UTC`;
}

// 全局应用外壳：顶部标题栏 + 左侧可折叠导航菜单 + 页面内容（Outlet）
// 沿用 Ground Station 的布局风格（AppBar + Drawer），供多个功能页面共用
export default function AppShell() {
  const [open, setOpen] = useState(false);       // 桌面端：展开 / 折叠（默认收起）
  const [mobileOpen, setMobileOpen] = useState(false); // 移动端抽屉
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = getNavigation();

  // 标题栏当前时间：按系统配置显示 UTC 或本地时间（每秒刷新）
  const timeDisplay = useSelector((s) => s.settings.values?.time_display || "utc");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleToggle = () => {
    if (window.innerWidth < 600) setMobileOpen((v) => !v);
    else setOpen((v) => !v);
  };

  const handleNav = (segment) => {
    navigate(`/${segment}`);
    if (window.innerWidth < 600) setMobileOpen(false);
  };

  // 按路径段精确匹配：/satellites3d 不应让 /satellites（卫星管理）也高亮
  const isActive = (segment) => {
    const p = location.pathname;
    return p === `/${segment}` || p.startsWith(`/${segment}/`);
  };

  // 导航内容（桌面端与移动端共用）
  const navContent = (expanded) => (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box component="nav" aria-label="主导航" sx={{ overflow: "auto", mt: 1, flex: 1 }}>
        <List>
          {navigation.map((item, index) => (
            <ListItem key={index} disablePadding sx={{ display: "block" }}>
              <Tooltip title={expanded ? "" : item.title} placement="right">
                <ListItemButton
                  onClick={() => handleNav(item.segment)}
                  selected={isActive(item.segment)}
                  sx={{
                    minHeight: 44,
                    justifyContent: expanded ? "flex-start" : "center",
                    px: expanded ? 2 : 0,
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 0,
                      mr: expanded ? 1.5 : 0,
                      justifyContent: "center",
                      color: "text.secondary",
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {expanded && <ListItemText primary={item.title} />}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          ))}
        </List>
      </Box>
      <Divider />
      <Typography variant="caption" sx={{ m: 1.5, color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden" }}>
        {expanded ? `卫星过境跟踪 v${APP_VERSION}` : `v${APP_VERSION}`}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* 顶部标题栏（背景/边框由 theme.js 的 MuiAppBar 按主题提供） */}
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <Toolbar sx={{ minHeight: 64, px: 2 }}>
          <IconButton color="inherit" aria-label="切换侧边菜单" edge="start" onClick={handleToggle} sx={{ mr: 1.5 }}>
            {open || mobileOpen ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
          <Typography variant="h6" component="div" sx={{ fontSize: 17, fontWeight: 600, flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            🛰️ 卫星过境跟踪
          </Typography>
          {/* 最右侧当前时间（UTC / 本地，跟随系统配置） */}
          <Typography variant="h6" component="div" sx={{ flexShrink: 0, fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", ml: 1 }}>
            {fmtNow(now, timeDisplay)}
          </Typography>
        </Toolbar>
      </AppBar>

      {/* 移动端抽屉（临时） */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", sm: "none" },
          "& .MuiDrawer-paper": { width: DRAWER_EXPANDED, boxSizing: "border-box", pt: 8 },
        }}
      >
        {navContent(true)}
      </Drawer>

      {/* 桌面端抽屉（常驻，可折叠） */}
      <Drawer
        variant="permanent"
        open={open}
        sx={{
          display: { xs: "none", sm: "block" },
          width: open ? DRAWER_EXPANDED : DRAWER_COLLAPSED,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: open ? DRAWER_EXPANDED : DRAWER_COLLAPSED,
            boxSizing: "border-box",
            pt: 8,
            overflowX: "hidden",
            transition: (theme) =>
              theme.transitions.create("width", {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.enteringScreen,
              }),
          },
        }}
      >
        {navContent(open)}
      </Drawer>

      {/* 主内容区：路由页面 */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          height: "100vh",
          pt: "64px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
