// useEChart Hook：管理单个 ECharts 实例的生命周期。
// 按 enabled 创建/销毁实例，绑定窗口 resize 与容器 ResizeObserver 自适应；
// 返回容器 ref 与实例 ref，组件在数据/配色变化时通过 chartRef.current.setOption 增量更新，
// 避免每次更新都重建实例（PolarChart / PassList 迷你图共用此生命周期）。
import { useEffect, useRef } from "react";
// 按需引入：本项目只用极坐标系下的折线（轨迹）与散点（采样点/标记/实时位置），
// 相比 `import * as echarts` 全量加载，可显著减小主包体积。
import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import { PolarComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([LineChart, ScatterChart, PolarComponent, TooltipComponent, CanvasRenderer]);

export function useEChart(enabled = true) {
  const ref = useRef(null);       // 挂载容器
  const chartRef = useRef(null);  // ECharts 实例

  useEffect(() => {
    if (!enabled || !ref.current) return;
    const chart = echarts.init(ref.current, null, { renderer: "canvas" });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    // flex 布局变化时容器尺寸会改，用 ResizeObserver 自动适配
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [enabled]);

  return { ref, chartRef };
}
