import React from "react";
import PublicIcon from "@mui/icons-material/Public";
import SettingsIcon from "@mui/icons-material/Settings";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";
import ExploreIcon from "@mui/icons-material/Explore";

// 左侧导航菜单配置：未来新增功能页面只需在此追加一项
export function getNavigation() {
  return [
    { segment: "track", title: "卫星轨迹", icon: <PublicIcon /> },
    { segment: "satellites", title: "卫星管理", icon: <SatelliteAltIcon /> },
    { segment: "satellites3d", title: "运行态势", icon: <ExploreIcon /> },
    { segment: "settings", title: "系统配置", icon: <SettingsIcon /> },
  ];
}
