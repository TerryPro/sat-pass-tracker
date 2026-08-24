// 全局常量：默认参数、选项列表、标签映射、内置数据 的单一来源。
// 各页面/组件/工具模块从这里引用，避免同一值散落多处导致不一致。

// ---------------------------------------------------------------
// 默认请求参数（后端设置加载失败时的回退值；可用 frontend/.env 的 VITE_DEFAULT_* 覆盖）
// ---------------------------------------------------------------
export const DEFAULT_PARAMS = {
  lat: Number(import.meta.env.VITE_DEFAULT_LAT || 39.9042),
  lon: Number(import.meta.env.VITE_DEFAULT_LON || 116.4074),
  alt: Number(import.meta.env.VITE_DEFAULT_ALT || 44),
  hours: Number(import.meta.env.VITE_DEFAULT_HOURS || 48),
  sample_interval: Number(import.meta.env.VITE_DEFAULT_SAMPLE_INTERVAL || 60),
  horizon: Number(import.meta.env.VITE_DEFAULT_HORIZON || 0),
};

// 内置预设站点（设置加载前的回退 / 后端未返回时的兜底）
export const PRESETS = {
  on80dd: { lat: 40.1458, lon: 116.2917, alt: 44, label: "ON80DD" },
  beijing: { lat: 39.9042, lon: 116.4074, alt: 44, label: "Beijing" },
};

// ---------------------------------------------------------------
// 设置页：主题 / 显示时长 / 采样间隔 下拉选项
// ---------------------------------------------------------------
export const THEMES = [
  { key: "dark", label: "暗色" },
  { key: "light", label: "亮色" },
];

export const HOUR_OPTIONS = [6, 12, 24, 48, 72, 168, 336];
export const SAMPLE_OPTIONS = [5, 10, 15, 30, 60, 120, 300, 600];

// 卫星详情对话框中的轨道参数中文标签
export const ORBIT_LABELS = {
  epoch: "TLE 历元",
  inclination_deg: "倾角 (°)",
  raan_deg: "升交点赤经 (°)",
  eccentricity: "偏心率",
  arg_perigee_deg: "近地点幅角 (°)",
  mean_anomaly_deg: "平近点角 (°)",
  mean_motion_rev_per_day: "平均运动 (圈/天)",
  period_min: "轨道周期 (分)",
  perigee_km: "近地点高度 (km)",
  apogee_km: "远地点高度 (km)",
};

// 卫星状态中文标签（SatNOGS status 字段）
export const STATUS_LABEL = { alive: "在轨运行", dead: "已失效", decayed: "已再入" };

// ---------------------------------------------------------------
// 内置卫星 / 地面站（与后端 store 一致，不可删除/编辑），作为后端未加载时的回退
// ---------------------------------------------------------------
export const BUILTIN_SATELLITES = [
  { id: "fo29", name: "FO-29 (JAS-2)", norad_id: 24278, builtin: true },
  { id: "iss", name: "国际空间站 ISS", norad_id: 25544, builtin: true },
  { id: "css", name: "中国空间站 CSS", norad_id: 48274, builtin: true },
];

export const BUILTIN_STATIONS = [
  { id: "on80dd", name: "ON80DD", lat: 40.1458, lon: 116.2917, alt: 44, builtin: true },
  { id: "beijing", name: "北京", lat: 39.9042, lon: 116.4074, alt: 44, builtin: true },
];

// ---------------------------------------------------------------
// 时间轴推演倍速：250ms/跳 × (倍速÷基准240×) = 每次步进的采样点数
// ---------------------------------------------------------------
export const PLAY_RATES = [30, 60, 120, 240, 720];

// ---------------------------------------------------------------
// 地图：显示时长哨兵值（-1 = 全部，跟随计算窗口）
// ---------------------------------------------------------------
export const ALL_HOURS = -1;
