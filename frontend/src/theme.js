import { createTheme } from "@mui/material/styles";

// 亮/暗主题配色（MUI 端）
// 注意：MUI v9 的 augmentColor 要求颜色为 { main } 对象，不接受裸字符串
const PALETTES = {
  dark: {
    mode: "dark",
    primary: { main: "#3b82f6" },
    secondary: { main: "#94a3b8" },
    success: { main: "#22c55e" },
    warning: { main: "#f59e0b" },
    error: { main: "#ef4444" },
    background: { default: "#0f1115", paper: "#161a22" },
    divider: "#232836",
    text: { primary: "#e6e8ef", secondary: "#9197a6" },
  },
  light: {
    mode: "light",
    primary: { main: "#2563eb" },
    secondary: { main: "#64748b" },
    success: { main: "#16a34a" },
    warning: { main: "#d97706" },
    error: { main: "#dc2626" },
    background: { default: "#f3f4f6", paper: "#ffffff" },
    divider: "#e5e7eb",
    text: { primary: "#111827", secondary: "#6b7280" },
  },
};

// 与 index.css 的 CSS 变量同名，供自定义样式跟随主题
// 说明：--aos/--peak/--los 已无引用，不再维护；画布类（地图/甘特图）配色留待组件化时处理
const CSS_VARS = {
  dark: {
    "--bg": "#0f1115",
    "--panel": "#161a22",
    "--border": "#232836",
    "--text": "#e6e8ef",
    "--muted": "#9197a6",
    "--accent": "#3b82f6",
    // 交互/悬浮/覆盖层等表面色（组件内已用 MUI action.*，此处保留仍被 var() 引用的令牌）
    "--overlay-bg": "rgba(15,23,42,0.7)",
    "--overlay-soft": "rgba(15,23,42,0.6)",
    "--accent-soft": "rgba(59,130,246,0.2)",
    "--scrollbar-thumb": "#475569",
    "--scrollbar-thumb-hover": "#64748b",
    "--canvas-bg": "rgba(15,23,42,0.85)", // 甘特图等画布底色（与绘制代码一致）
  },
  light: {
    "--bg": "#f3f4f6",
    "--panel": "#ffffff",
    "--border": "#e5e7eb",
    "--text": "#111827",
    "--muted": "#6b7280",
    "--accent": "#2563eb",
    "--overlay-bg": "rgba(255,255,255,0.72)",
    "--overlay-soft": "rgba(255,255,255,0.6)",
    "--accent-soft": "rgba(37,99,235,0.12)",
    "--scrollbar-thumb": "#cbd5e1",
    "--scrollbar-thumb-hover": "#94a3b8",
    "--canvas-bg": "rgba(255,255,255,0.9)",
  },
};

// 按模式生成 MUI 主题
export function createAppTheme(mode = "dark") {
  const palette = PALETTES[mode] || PALETTES.dark;
  return createTheme({
    palette,
    shape: { borderRadius: 8 },
    typography: {
      fontSize: 13, // 全局基础字号（默认 14），略微减小
      h6: { fontSize: 17, fontWeight: 600 },
      subtitle1: { fontSize: 15, fontWeight: 600 },
      body2: { fontSize: 13 },
      caption: { fontSize: 12 },
    },
    components: {
      MuiAppBar: {
        defaultProps: { elevation: 0, color: "transparent" },
        styleOverrides: {
          root: {
            borderBottom: "1px solid",
            borderColor: palette.divider,
            backgroundColor: palette.background.default,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: palette.mode === "dark" ? "#11141b" : "#fafafa",
            borderRight: "1px solid",
            borderColor: palette.divider,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            margin: "2px 6px",
            "&.Mui-selected": {
              backgroundColor: "rgba(59, 130, 246, 0.18)",
              color: palette.primary.main,
              "& .MuiListItemIcon-root": { color: palette.primary.main },
            },
          },
        },
      },
      // 工具栏/表单控件统一缩小：标签与输入文本
      MuiInputLabel: {
        styleOverrides: { root: { fontSize: 12 } },
      },
      MuiOutlinedInput: {
        styleOverrides: { root: { fontSize: 13 } },
      },
      MuiMenuItem: {
        styleOverrides: { root: { fontSize: 13 } },
      },
      MuiButton: {
        styleOverrides: { root: { fontSize: 13 } },
      },
      MuiToggleButton: {
        styleOverrides: { root: { fontSize: 13 } },
      },
      MuiFormControlLabel: {
        styleOverrides: { label: { fontSize: 13 } },
      },
      MuiSwitch: {
        styleOverrides: { root: { fontSize: 13 } },
      },
    },
  });
}

// 应用/移除 CSS 变量，让 index.css 中的自定义样式跟随主题
// 同时在 <html> 上记录 data-theme，供 canvas 绘制（甘特图等）读取当前主题取色
export function applyThemeCssVars(mode = "dark") {
  const vars = CSS_VARS[mode] || CSS_VARS.dark;
  const root = document.documentElement;
  root.dataset.theme = mode;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

export default createAppTheme("dark");
