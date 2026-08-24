// ECharts option 构建：主图（极坐标天顶图）与列表缩略图。
import { a, angleToAz, r, r2el } from "./polar.js";
import { buildVisSamples } from "./data.js";
import { CHART_PALETTES } from "./utils.js";

// 主图 option（含坐标系、轨迹、采样点、AOS/Peak/LOS 标记、当前位置）
export function buildMainOption(p, currentPos, palette = CHART_PALETTES.dark) {
  if (!p || !p.samples) return {}; // 无过境数据时返回空 option，避免崩溃
  const { visSamples, peak } = buildVisSamples(p.samples);
  const isEmpty = !visSamples || visSamples.length === 0;

  // 绘制采样：当样本过多时按极坐标像素距离 + 关键点（AOS/Peak/LOS）降采样，
  // 避免高轨卫星长过境逐点叠加后线条"发黑/变粗"（ECharts 每段线会被重复渲染叠加）。
  // 关键阈值：TARGET 是最终要保留的绘制点（绘制点约 200 个 ~= 1.5px/点在 400px 容器里）；
  // MIN_DIST 是相邻两点在极坐标中必须满足的最小（角度+仰角）距离，小于则跳过。
  const TARGET_DRAW = 200;
  const MIN_ANGLE_DIST_DEG = 0.6;  // 角度方向阈值（度）
  const MIN_EL_DIST_DEG = 0.4;     // 仰角方向阈值（度）

  let drawSamples = visSamples;
  if (!isEmpty && visSamples.length > TARGET_DRAW * 1.5) {
    const step = Math.ceil(visSamples.length / TARGET_DRAW);
    // 强制保留 AOS、Peak、LOS（通过它们在 visSamples 中的索引）
    let peakIdx = visSamples.indexOf(peak);
    if (peakIdx < 0) {
      // indexOf 找不回就按 el 峰值再定位一次（极坐标数据里 el 相同可能存在多个点，保险起见）
      let bestEl = -1;
      peakIdx = 0;
      for (let i = 0; i < visSamples.length; i++) {
        if (visSamples[i].el > bestEl) { bestEl = visSamples[i].el; peakIdx = i; }
      }
    }
    const keep = new Set([0, visSamples.length - 1, peakIdx]);
    // 按步长抽，同时极坐标距离太近就跳过（防止原地抖动/微小重复）
    const chosen = [];
    let lastR = r(visSamples[0].el);
    let lastA = a(visSamples[0].contAz);
    for (let i = 0; i < visSamples.length; i++) {
      if (keep.has(i)) { chosen.push(i); lastR = r(visSamples[i].el); lastA = a(visSamples[i].contAz); continue; }
      if (i % step !== 0) continue;
      const curR = r(visSamples[i].el);
      const curA = a(visSamples[i].contAz);
      const dA = Math.abs(curA - lastA);
      const dR = Math.abs(curR - lastR);
      if (dA < MIN_ANGLE_DIST_DEG && dR < MIN_EL_DIST_DEG) continue;
      chosen.push(i);
      lastR = curR;
      lastA = curA;
    }
    // 首尾可能被距离过滤去掉，补回一次（保证闭合端点永远在）
    if (chosen[0] !== 0) chosen.unshift(0);
    if (chosen[chosen.length - 1] !== visSamples.length - 1) chosen.push(visSamples.length - 1);
    drawSamples = chosen.map((i) => visSamples[i]);
  }

  const base = {
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        if (!params) return "";
        const val = params.value || params.data;
        if (!val || val.length < 2) return "";
        const [rv, ang] = val; // 数据顺序 [半径, 角度]
        const name = params.seriesName || "";
        return (name ? name + "<br/>" : "") +
          `方位 ${angleToAz(ang).toFixed(1)}°<br/>仰角 ${r2el(rv).toFixed(1)}°`;
      },
    },
    polar: { radius: ["0%", "78%"], center: ["50%", "55%"] },
    angleAxis: {
      type: "value", min: 0, max: 360,
      interval: 30,
      startAngle: 0,     // 角度 0 在东侧(3点钟)
      clockwise: false,  // 逆时针增大 → 90°(正北)在正上方
      axisLine: { lineStyle: { color: palette.axis } },
      axisTick: { show: true, lineStyle: { color: palette.axis }, length: 4 },
      splitLine: { lineStyle: { color: palette.axis } },
      axisLabel: {
        color: palette.axisLabel,
        fontWeight: 600,
        formatter: (v) => ({ 0: "E", 90: "N", 180: "W", 270: "S" }[v] || ""),
        fontSize: 14,
      },
    },
    radiusAxis: {
      type: "value", min: 0, max: 90,
      interval: 15,
      inverse: false, // min=0(中心), max=90(外圈)
      axisLine: { show: false },
      axisTick: { show: true, lineStyle: { color: palette.axis }, length: 4 },
      axisLabel: {
        color: palette.axisLabel,
        formatter: (rv) => r2el(rv) + "°", // 外圈 r=90 → 0°(地平线)，中心 r=0 → 90°(天顶)
        fontSize: 11,
      },
      splitLine: { lineStyle: { color: palette.axis } },
    },
    series: [],
  };

  if (isEmpty) {
    return { ...base, series: [] };
  }

  const aosPt = visSamples[0];
  const losPt = visSamples[visSamples.length - 1];
  const aosR = r(aosPt.el);
  const losR = r(losPt.el);
  const peakR = r(peak.el);
  const trace = drawSamples.map((s) => [r(s.el), a(s.contAz)]);

  // 绘制采样点（小蓝点）只在抽样后的 drawSamples 上画，但 AOS/Peak/LOS 这三个关键点
  // 无论是否在降采样中都要显示——直接用 visSamples 的原始三点
  const tagMap = new Map();
  tagMap.set(visSamples[0], "AOS");
  tagMap.set(peak, "Peak");
  tagMap.set(visSamples[visSamples.length - 1], "LOS");

  const series = [
    {
      name: "轨迹", type: "line", coordinateSystem: "polar", data: trace,
      showSymbol: false, smooth: false,
      lineStyle: { width: 2.4, color: palette.track }, z: 1,
    },
    {
      name: "采样点", type: "scatter", coordinateSystem: "polar",
      data: drawSamples.map((s) => {
        const tag = tagMap.get(s) || "";
        return {
          value: [r(s.el), a(s.contAz)],
          orig: {
            t: s.t, az: s.az, contAz: s.contAz, el: s.el, r_km: s.r_km, tag,
          },
        };
      }),
      symbolSize: (raw, params) => {
        const o = params && params.data && params.data.orig;
        if (!o) return 6;
        if (o.tag === "AOS" || o.tag === "LOS") return 11;
        if (o.tag === "Peak") return 13;
        return 5;
      },
      itemStyle: {
        color: (params) => {
          const o = params && params.data && params.data.orig;
          if (!o) return palette.track;
          if (o.tag === "AOS") return palette.aos;
          if (o.tag === "LOS") return palette.los;
          if (o.tag === "Peak") return palette.peak;
          return palette.track;
        },
        borderWidth: 0,
        opacity: 0.9,
      },
      z: 2,
    },
    {
      name: "AOS (升起)", type: "scatter", coordinateSystem: "polar",
      data: [[aosR, a(aosPt.contAz)]], symbolSize: 13,
      itemStyle: { color: palette.aos, borderColor: "#fff", borderWidth: 1.2 }, z: 3,
    },
    {
      name: "最高点", type: "scatter", coordinateSystem: "polar",
      data: [[peakR, a(peak.contAz)]], symbolSize: 15,
      itemStyle: { color: palette.peak, borderColor: "#fff", borderWidth: 1.2 }, z: 3,
    },
    {
      name: "LOS (落下)", type: "scatter", coordinateSystem: "polar",
      data: [[losR, a(losPt.contAz)]], symbolSize: 13,
      itemStyle: { color: palette.los, borderColor: "#fff", borderWidth: 1.2 }, z: 3,
    },
  ];

  // 当前卫星位置（Socket.IO 实时推送）：仅当高于地平线（el>=0）时显示
  if (currentPos && typeof currentPos.el === "number" && currentPos.el >= 0) {
    series.push({
      name: "当前位置", type: "scatter", coordinateSystem: "polar",
      data: [[r(currentPos.el), a(currentPos.az)]], symbolSize: 18,
      itemStyle: {
        color: palette.peak, borderColor: "#fff", borderWidth: 2,
        shadowBlur: 14, shadowColor: palette.peak,
      }, z: 4,
    });
  }

  return { ...base, series, _visSamples: visSamples, _peak: peak };
}

// 列表缩略图 option（带坐标系：辐线 + 同心圆 + N/E/S/W）
export function miniOption(p, palette = CHART_PALETTES.dark) {
  const trace = p.samples.map((s) => [90 - s.el, 90 - s.az]);
  const peak = p.samples.reduce((a, b) => (b.el > a.el ? b : a), p.samples[0]);
  return {
    animation: false,
    polar: { radius: ["0%", "88%"], center: ["50%", "52%"] },
    angleAxis: {
      type: "value", min: 0, max: 360,
      startAngle: 0, clockwise: false,
      splitNumber: 12, // 每 30° 一条辐线
      axisLine: { show: true, lineStyle: { color: palette.tick, width: 1 } },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: palette.axis, width: 0.5 } },
      axisLabel: {
        show: true, color: palette.tickLabel, fontSize: 8, fontWeight: 600, margin: 2,
        formatter: (v) => ({ 0: "E", 90: "N", 180: "W", 270: "S" }[v] || ""),
      },
    },
    radiusAxis: {
      type: "value", min: 0, max: 90,
      interval: 15,
      inverse: false,
      axisLine: { show: true, lineStyle: { color: palette.tick, width: 1 } },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: palette.axis, width: 0.5 } },
      axisLabel: { show: false }, // 缩略图小，径向数值省略
    },
    series: [
      {
        type: "line", coordinateSystem: "polar", data: trace,
        showSymbol: false, smooth: true,
        lineStyle: { width: 1.5, color: palette.track },
      },
      {
        type: "scatter", coordinateSystem: "polar",
        data: [[90 - p.samples[0].el, 90 - p.samples[0].az]],
        symbolSize: 6, itemStyle: { color: palette.aos },
      },
      {
        type: "scatter", coordinateSystem: "polar",
        data: [[90 - peak.el, 90 - peak.az]],
        symbolSize: 7, itemStyle: { color: palette.los },
      },
      {
        type: "scatter", coordinateSystem: "polar",
        data: [[90 - p.samples[p.samples.length - 1].el, 90 - p.samples[p.samples.length - 1].az]],
        symbolSize: 6, itemStyle: { color: palette.miniLos },
      },
    ],
  };
}
