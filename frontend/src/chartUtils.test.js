// chartUtils 极坐标映射工具单元测试（针对 chart/ 子模块）
import { describe, expect, it } from "vitest";
import {
  a,
  angleToAz,
  r,
  r2el,
  unwrapAz,
} from "./chart/polar.js";
import {
  buildVisSamples,
  calcSamplingInterval,
  interpElZero,
} from "./chart/data.js";
import {
  buildMainOption,
  miniOption,
} from "./chart/options.js";
import {
  CHART_PALETTES,
  chartPalette,
  fmt,
  fmtTime,
} from "./chart/utils.js";
import * as barrel from "./chartUtils.js";

describe("unwrapAz 方位角连续化", () => {
  it("跨 360→0 边界不跳变", () => {
    expect(unwrapAz([350, 355, 2, 8])).toEqual([350, 355, 362, 368]);
  });
  it("反向跨边界", () => {
    expect(unwrapAz([10, 5, 355, 350])).toEqual([10, 5, -5, -10]);
  });
  it("空/无效输入", () => {
    expect(unwrapAz([])).toEqual([]);
    expect(unwrapAz(null)).toEqual([]);
    expect(unwrapAz(undefined)).toEqual([]);
  });
});

describe("极坐标映射 r/a", () => {
  it("el→半径：0°→90 外圈，90°→0 中心", () => {
    expect(r(0)).toBe(90);
    expect(r(90)).toBe(0);
    expect(r(45)).toBe(45);
  });
  it("半径钳制到 [0,90]", () => {
    expect(r(-10)).toBe(90);
    expect(r(100)).toBe(0);
  });
  it("az→角度：N(0)→90，E(90)→0", () => {
    expect(a(0)).toBe(90);
    expect(a(90)).toBe(0);
  });
  it("反算一致", () => {
    expect(angleToAz(a(123))).toBeCloseTo(123);
    expect(r2el(r(30))).toBe(30);
  });
});

describe("interpElZero 地平线插值", () => {
  const s0 = { t: "2026-01-01T00:00:00Z", el: -10, az: 100, r_km: 2000 };
  const s1 = { t: "2026-01-01T00:01:00Z", el: 10, az: 110, r_km: 1900 };

  it("el 归零、时间/方位/距离按比例插值", () => {
    const p = interpElZero(s0, s1, 100, 110);
    expect(p.el).toBe(0);
    expect(p.isInterpolated).toBe(true);
    expect(p.origIndex).toBe(-1);
    expect(p.contAz).toBeCloseTo(105); // 连续方位角插值
    expect(p.az).toBeCloseTo(105);
    expect(p.r_km).toBeCloseTo(1950);
    expect(p.t).toBe("2026-01-01T00:00:30.000Z"); // el 在 30s 处跨越 0°
  });
});

describe("buildVisSamples 可见段构建", () => {
  const raw = [
    { t: "2026-01-01T00:00:00Z", az: 100, el: -5, r_km: 2000 },
    { t: "2026-01-01T00:01:00Z", az: 110, el: 10, r_km: 1900 },
    { t: "2026-01-01T00:02:00Z", az: 130, el: 30, r_km: 1700 },
    { t: "2026-01-01T00:03:00Z", az: 160, el: 8, r_km: 1800 },
    { t: "2026-01-01T00:04:00Z", az: 180, el: -3, r_km: 2000 },
  ];

  it("首尾插值 + 中间原样 + 峰值正确", () => {
    const { visSamples, peak } = buildVisSamples(raw);
    expect(visSamples.length).toBeGreaterThanOrEqual(4);
    expect(visSamples[0].isInterpolated).toBe(true);
    expect(visSamples[0].el).toBe(0);
    expect(visSamples[visSamples.length - 1].isInterpolated).toBe(true);
    expect(visSamples[visSamples.length - 1].el).toBe(0);
    expect(peak.el).toBe(30); // el 最大的中间点
  });

  it("端点贴近地平线时去重复用插值点", () => {
    const nearEdge = [
      { t: "2026-01-01T00:00:00Z", az: 100, el: 0, r_km: 2000 },   // el=0 → 直接复用为 AOS
      { t: "2026-01-01T00:01:00Z", az: 110, el: 30, r_km: 1900 },
      { t: "2026-01-01T00:02:00Z", az: 120, el: 0.5, r_km: 1900 }, // el<1° → 复用为 LOS
    ];
    const { visSamples } = buildVisSamples(nearEdge);
    expect(visSamples.length).toBe(3);
    expect(visSamples[0].el).toBe(0);
    expect(visSamples[0].isInterpolated).toBe(true);
    expect(visSamples[2].el).toBe(0);
    expect(visSamples[2].isInterpolated).toBe(true);
  });

  it("全部在地平线下 → 空", () => {
    const below = [
      { t: "2026-01-01T00:00:00Z", az: 100, el: -5, r_km: 2000 },
      { t: "2026-01-01T00:01:00Z", az: 110, el: -3, r_km: 1900 },
      { t: "2026-01-01T00:02:00Z", az: 120, el: -2, r_km: 1800 },
      { t: "2026-01-01T00:03:00Z", az: 130, el: -4, r_km: 1900 },
    ];
    expect(buildVisSamples(below).visSamples).toEqual([]);
  });

  it("数据不足 → 空", () => {
    expect(buildVisSamples(null).visSamples).toEqual([]);
    expect(
      buildVisSamples([{ t: "x", az: 1, el: 1, r_km: 1 }]).visSamples
    ).toEqual([]);
  });
});

describe("calcSamplingInterval 采样间隔统计", () => {
  it("平均值 / 原始点计数 / 插值点计数", () => {
    const vs = [
      { t: "2026-01-01T00:00:00Z", el: 0, isInterpolated: true },
      { t: "2026-01-01T00:01:00Z", el: 5, isInterpolated: false },
      { t: "2026-01-01T00:03:00Z", el: 8, isInterpolated: false },
    ];
    const st = calcSamplingInterval(vs);
    expect(st.avg).toBeCloseTo(90); // (60+120)/2 = 90s
    expect(st.min).toBe(60);
    expect(st.max).toBe(120);
    expect(st.rawCount).toBe(2);
    expect(st.interpCount).toBe(1);
  });
  it("不足两点返回 0", () => {
    const st = calcSamplingInterval([{ t: "x", el: 1 }]);
    expect(st.avg).toBe(0);
    expect(st.rawCount).toBe(1);
    expect(st.interpCount).toBe(0);
  });
});

describe("buildMainOption / miniOption 结构", () => {
  const pass = {
    samples: [
      { t: "2026-01-01T00:00:00Z", az: 100, el: 0, r_km: 2000 },
      { t: "2026-01-01T00:01:00Z", az: 120, el: 25, r_km: 1800 },
      { t: "2026-01-01T00:02:00Z", az: 150, el: 10, r_km: 1900 },
    ],
  };

  it("buildMainOption 生成系列与关键点", () => {
    const opt = buildMainOption(pass, null);
    expect(opt.series.length).toBeGreaterThanOrEqual(4);
    expect(opt._visSamples).toBeDefined();
    expect(opt._peak).toBeDefined();
  });
  it("无数据返回空 option", () => {
    expect(buildMainOption(null, null)).toEqual({});
    expect(buildMainOption({}, null)).toEqual({});
  });
  it("miniOption 轨迹点数与采样一致", () => {
    const opt = miniOption(pass);
    expect(opt.series[0].data.length).toBe(3);
  });
  it("调色板随主题切换改变轴线/文字颜色", () => {
    const darkOpt = buildMainOption(pass, null, CHART_PALETTES.dark);
    const lightOpt = buildMainOption(pass, null, CHART_PALETTES.light);
    expect(darkOpt.angleAxis.axisLabel.color).toBe("#9aa2b4");
    expect(lightOpt.angleAxis.axisLabel.color).toBe("#6b7280");
    expect(lightOpt.angleAxis.axisLine.lineStyle.color).toBe("#d1d5db");
    expect(lightOpt.series[0].lineStyle.color).toBe("#3b82f6");
    const miniLight = miniOption(pass, CHART_PALETTES.light);
    expect(miniLight.angleAxis.axisLabel.color).toBe("#6b7280");
  });

  it("tooltip formatter 反算方位/仰角", () => {
    const opt = buildMainOption(pass, null);
    const html = opt.tooltip.formatter({ value: [60, 30], seriesName: "轨迹" });
    expect(html).toContain("轨迹");
    expect(html).toContain("方位 60.0"); // angleToAz(30)=60
    expect(html).toContain("仰角 30.0"); // r2el(60)=30
  });

  it("当前位置 el>=0 时追加系列，低于地平线时不显示", () => {
    const above = buildMainOption(pass, { az: 130, el: 20 });
    const cur = above.series.find((s) => s.name === "当前位置");
    expect(cur).toBeDefined();
    expect(cur.data).toEqual([[70, -40]]); // r=90-20, a=90-130

    const below = buildMainOption(pass, { az: 130, el: -5 });
    expect(below.series.find((s) => s.name === "当前位置")).toBeUndefined();
  });

  it("样本过多时降采样且保留 AOS/Peak/LOS", () => {
    const n = 400;
    const raw = Array.from({ length: n }, (_, i) => ({
      t: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      az: (i * 0.9) % 360,
      el: -5 + 45 * Math.sin((Math.PI * i) / (n - 1)),
      r_km: 2000,
    }));
    const opt = buildMainOption({ samples: raw }, null);
    const trace = opt.series[0].data;
    expect(opt._visSamples.length).toBeGreaterThan(300); // 触发降采样
    expect(trace.length).toBeLessThanOrEqual(210);        // 绘制点被压缩
    expect(opt._peak.el).toBeGreaterThan(39);             // 峰值被强制保留
    expect(opt._peak.el).toBeLessThan(40.01);
  });
});

describe("chartPalette / fmt / fmtTime", () => {
  it("无 document 时回退暗色调色板", () => {
    expect(chartPalette()).toEqual(CHART_PALETTES.dark);
  });

  it("跟随 <html data-theme> 返回对应调色板", () => {
    const saved = globalThis.document;
    globalThis.document = { documentElement: { dataset: { theme: "light" } } };
    try {
      expect(chartPalette()).toEqual(CHART_PALETTES.light);
    } finally {
      globalThis.document = saved;
    }
  });

  it("fmt 输出非空字符串", () => {
    expect(typeof fmt("2026-01-01T00:00:00Z")).toBe("string");
  });

  it("fmtTime 带毫秒时追加毫秒", () => {
    const s = fmtTime("2026-01-01T00:00:00.123Z", true);
    expect(typeof s).toBe("string");
    expect(s.endsWith(".123")).toBe(true);
    const s2 = fmtTime("2026-01-01T00:00:00Z");
    expect(s2.length).toBeGreaterThan(0);
  });
});

describe("chartUtils barrel 再导出一致性", () => {
  it("与子模块导出保持同一引用", () => {
    expect(barrel.buildMainOption).toBe(buildMainOption);
    expect(barrel.miniOption).toBe(miniOption);
    expect(barrel.buildVisSamples).toBe(buildVisSamples);
    expect(barrel.calcSamplingInterval).toBe(calcSamplingInterval);
    expect(barrel.interpElZero).toBe(interpElZero);
    expect(barrel.unwrapAz).toBe(unwrapAz);
    expect(barrel.a).toBe(a);
    expect(barrel.r).toBe(r);
    expect(barrel.angleToAz).toBe(angleToAz);
    expect(barrel.r2el).toBe(r2el);
    expect(barrel.CHART_PALETTES).toBe(CHART_PALETTES);
    expect(barrel.chartPalette).toBe(chartPalette);
    expect(barrel.fmt).toBe(fmt);
    expect(barrel.fmtTime).toBe(fmtTime);
  });
});
