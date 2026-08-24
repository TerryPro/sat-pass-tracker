import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { buildMainOption, CHART_PALETTES, fmt, fmtTime } from "../chartUtils.js";
import { useAppTheme } from "../hooks/useAppTheme.js";
import { useEChart } from "../hooks/useEChart.js";

// 图例圆点
function Dot({ c, glow }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        bgcolor: c,
        mr: 0.5,
        verticalAlign: "middle",
        ...(glow ? { boxShadow: `0 0 6px ${c}` } : {}),
      }}
    />
  );
}

// 主极坐标图（ECharts）：轨迹 + 采样点 + AOS/Peak/LOS + 实时当前位置
export default function PolarChart({ pass, currentPos, compact }) {
  // 图 / 数据表格 切换显示（滑动开关，默认图表视图）
  const [showTable, setShowTable] = useState(false);
  // 图表配色跟随应用主题（settings 中的 theme 字段）
  const theme = useAppTheme();
  const palette = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  // 图表实例生命周期：仅在“图”视图激活时创建，切换表格时销毁（避免容器卸载后残留旧实例）
  const { ref, chartRef } = useEChart(!showTable);

  // 数据变化 → 更新 option（主题切换时也重建，保证配色一致）
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!pass || !pass.samples) return; // 无过境数据时保持空图，避免崩溃
    chart.setOption(buildMainOption(pass, currentPos, palette), true);
  }, [pass, currentPos, palette, showTable]);

  const samples = pass && pass.samples ? pass.samples : [];

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        // 原 .sidebar-chart > .card：透明背景、无边框、无内边距，由外层容器提供
      }}
    >
      {!pass ? (
        <Box sx={{ p: 3, textAlign: "center", color: "text.secondary", fontSize: 13 }}>
          加载数据后显示
        </Box>
      ) : (
        <>
          {/* 图 / 表格切换开关（右上角悬浮，紧凑模式也显示） */}
          <Box
            sx={{
              position: "absolute",
              top: 0,
              right: 4,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: 0.25,
            }}
          >
            <Typography variant="caption" sx={{ color: "var(--muted)", fontSize: 11, userSelect: "none" }}>
              数据
            </Typography>
            <Switch
              size="small"
              checked={showTable}
              onChange={(e) => setShowTable(e.target.checked)}
              title="图 / 数据表格切换"
              aria-label="图 / 数据表格切换"
            />
          </Box>
          {showTable ? (
            /* 数据表格视图：表头固定（不随数据滚动），数据区独立滚动，
               避免滚动时数据覆盖表头；两表用固定布局保证列宽一致 */
            <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", pt: 3 }}>
              <Table size="small" sx={{ tableLayout: "fixed" }}>
                <TableHead>
                  <TableRow>
                    {!compact && <TableCell sx={{ bgcolor: "var(--panel)" }}>序号</TableCell>}
                    <TableCell sx={{ bgcolor: "var(--panel)" }}>时间</TableCell>
                    <TableCell align="right" sx={{ bgcolor: "var(--panel)" }}>方位角</TableCell>
                    <TableCell align="right" sx={{ bgcolor: "var(--panel)" }}>仰角</TableCell>
                    {!compact && <TableCell align="right" sx={{ bgcolor: "var(--panel)" }}>距离</TableCell>}
                  </TableRow>
                </TableHead>
              </Table>
              <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <Table size="small" sx={{ tableLayout: "fixed" }}>
                  <TableBody>
                    {samples.map((s, i) => (
                      <TableRow key={i} hover>
                        {!compact && <TableCell>{i + 1}</TableCell>}
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{compact ? fmtTime(s.t) : fmt(s.t)}</TableCell>
                        <TableCell align="right">{s.az.toFixed(1)}°</TableCell>
                        <TableCell align="right">{s.el.toFixed(1)}°</TableCell>
                        {!compact && <TableCell align="right">{s.r_km ? s.r_km.toFixed(0) + " km" : "—"}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          ) : (
            <>
              <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
                <Box ref={ref} sx={{ width: "100%", height: "100%", minHeight: 0 }} />
              </Box>
              {!compact && (
                <Box
                  sx={{
                    display: "flex",
                    gap: 2,
                    flexWrap: "wrap",
                    fontSize: 12,
                    color: "text.secondary",
                    mt: 1,
                    px: 0.5,
                  }}
                >
                  <Box component="span" sx={{ whiteSpace: "nowrap" }}><Dot c="#ef4444" />AOS</Box>
                  <Box component="span" sx={{ whiteSpace: "nowrap" }}><Dot c="#f59e0b" />最高点</Box>
                  <Box component="span" sx={{ whiteSpace: "nowrap" }}><Dot c="#22c55e" />LOS</Box>
                  <Box component="span" sx={{ whiteSpace: "nowrap" }}><Dot c="#60a5fa" />轨迹</Box>
                  {currentPos && currentPos.el >= 0 && (
                    <Box component="span" sx={{ whiteSpace: "nowrap" }}>
                      <Dot c="#f59e0b" glow />当前
                    </Box>
                  )}
                </Box>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}
