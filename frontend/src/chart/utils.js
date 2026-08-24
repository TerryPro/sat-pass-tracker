// 通用工具：图表调色板与时间格式化。

// 图表调色板（随应用主题切换；语义色在亮暗下略有差异以保证对比度）
export const CHART_PALETTES = {
  dark: {
    axis: "#2b3142",          // 坐标轴线 / 刻度 / 分割线
    axisLabel: "#9aa2b4",     // 轴标签文字
    tick: "#3a4156",          // 迷你图坐标轴
    tickLabel: "#8b94a8",     // 迷你图轴标签
    track: "#60a5fa",         // 轨迹线 / 采样点
    aos: "#ef4444",           // AOS
    peak: "#f59e0b",          // 最高点 / 当前位置
    los: "#22c55e",           // LOS
    miniLos: "#3b82f6",       // 迷你图 LOS 点
  },
  light: {
    axis: "#d1d5db",
    axisLabel: "#6b7280",
    tick: "#d1d5db",
    tickLabel: "#6b7280",
    track: "#3b82f6",
    aos: "#dc2626",
    peak: "#d97706",
    los: "#16a34a",
    miniLos: "#2563eb",
  },
};

// 当前主题调色板（跟随 <html data-theme>，供无 React 上下文处取用）
export function chartPalette() {
  const mode =
    typeof document !== "undefined" ? document.documentElement.dataset.theme : "dark";
  return CHART_PALETTES[mode] || CHART_PALETTES.dark;
}

// 完整时间格式化（UTC → 本地时区，含日期；空值显示占位符）
function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
}

// 时间格式化（UTC → 本地时区，用于表格显示）
export function fmtTime(iso, withMs = false) {
  const d = new Date(iso);
  const base = d.toLocaleTimeString("zh-CN", { hour12: false });
  return withMs ? base + "." + String(d.getMilliseconds()).padStart(3, "0") : base;
}

export { fmt };
