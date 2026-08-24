// 数据处理：从后端原始采样构造“可见样本序列”，以及采样间隔统计。
import { unwrapAz } from "./polar.js";

// 在 s0(el<0) 与 s1(el>=0) 之间线性插值出 el=0 的点
export function interpElZero(s0, s1, contAz0, contAz1) {
  const e0 = s0.el, e1 = s1.el;
  const k = (0 - e0) / (e1 - e0); // 0~1
  const t0 = new Date(s0.t).getTime();
  const t1 = new Date(s1.t).getTime();
  const tIso = new Date(t0 + k * (t1 - t0)).toISOString();
  return {
    origIndex: -1,
    isInterpolated: true,
    t: tIso,
    az: (((s0.az + k * (s1.az - s0.az)) % 360) + 360) % 360,
    contAz: contAz0 + k * (contAz1 - contAz0),
    el: 0, // 强制 0，落在最外圈
    r_km: s0.r_km + k * (s1.r_km - s0.r_km),
  };
}

// 从后端原始采样构造“可见样本序列”：
//   插值 AOS（el 跨越 0°）→ 原始样本 → 插值 LOS；首尾端点贴近地平线时去重复用
export function buildVisSamples(rawSamples) {
  if (!rawSamples || rawSamples.length < 2) return { visSamples: [], peak: null };

  const fullContAz = unwrapAz(rawSamples.map((s) => s.az));

  // 1) 找到 el 跨越 0° 的位置，插值 AOS（el<0 → el>=0）
  let aosSample = null;
  let startI = -1;
  for (let i = 0; i < rawSamples.length; i++) {
    if (rawSamples[i].el >= 0) {
      if (i === 0) {
        startI = 0;
        aosSample = {
          origIndex: 0, isInterpolated: true, t: rawSamples[0].t,
          az: rawSamples[0].az, contAz: fullContAz[0],
          el: 0, r_km: rawSamples[0].r_km,
        };
      } else {
        startI = i;
        aosSample = interpElZero(rawSamples[i - 1], rawSamples[i], fullContAz[i - 1], fullContAz[i]);
      }
      break;
    }
  }
  if (aosSample === null) return { visSamples: [], peak: null };

  // 2) 找到 el 最后一次 >=0 的位置，插值 LOS
  let losSample = null;
  let endI = -1;
  for (let i = rawSamples.length - 1; i >= 0; i--) {
    if (rawSamples[i].el >= 0) {
      if (i === rawSamples.length - 1) {
        endI = i;
        losSample = {
          origIndex: i, isInterpolated: true, t: rawSamples[i].t,
          az: rawSamples[i].az, contAz: fullContAz[i],
          el: 0, r_km: rawSamples[i].r_km,
        };
      } else {
        endI = i;
        losSample = interpElZero(rawSamples[i + 1], rawSamples[i], fullContAz[i + 1], fullContAz[i]);
      }
      break;
    }
  }
  if (losSample === null || endI < startI) return { visSamples: [], peak: null };

  // 3) 组合中间原始样本
  const middleSamples = [];
  for (let i = startI; i <= endI; i++) {
    middleSamples.push({
      origIndex: i, isInterpolated: false,
      t: rawSamples[i].t,
      az: rawSamples[i].az,
      contAz: fullContAz[i],
      el: Math.max(0, rawSamples[i].el), // 钳制以防浮点微小负数
      r_km: rawSamples[i].r_km,
    });
  }

  // 端点去重：若端点本身已贴近地平线（el<1° 或距插值点时差<3s），直接钳为 0 复用，
  // 避免“插值点 + 几乎同位置的原始点”造成首/尾两点重合
  const DUPLICATE_TOL_SEC = 3;
  const DUPLICATE_EL_TOL = 1.0;
  let prependAos = true;
  let appendLos = true;
  if (middleSamples.length > 0) {
    const firstEl = middleSamples[0].el;
    const dtAos = Math.abs((new Date(middleSamples[0].t) - new Date(aosSample.t)) / 1000);
    if (firstEl < DUPLICATE_EL_TOL || dtAos < DUPLICATE_TOL_SEC) {
      middleSamples[0].el = 0;
      middleSamples[0].isInterpolated = true;
      prependAos = false;
    }
    const lastEl = middleSamples[middleSamples.length - 1].el;
    const dtLos = Math.abs((new Date(losSample.t) - new Date(middleSamples[middleSamples.length - 1].t)) / 1000);
    if (lastEl < DUPLICATE_EL_TOL || dtLos < DUPLICATE_TOL_SEC) {
      middleSamples[middleSamples.length - 1].el = 0;
      middleSamples[middleSamples.length - 1].isInterpolated = true;
      appendLos = false;
    }
  }

  const visSamples = [
    ...(prependAos ? [aosSample] : []),
    ...middleSamples,
    ...(appendLos ? [losSample] : []),
  ];

  let peak = middleSamples[0] || visSamples[0];
  middleSamples.forEach((s) => { if (s.el > peak.el) peak = s; });
  return { visSamples, peak };
}

// 计算采样间隔统计（排除插值点后更接近真实配置）
export function calcSamplingInterval(visSamples) {
  if (!visSamples || visSamples.length < 2) {
    return { avg: 0, min: 0, max: 0, rawCount: visSamples ? visSamples.length : 0, interpCount: 0 };
  }
  const orig = visSamples.filter((s) => !s.isInterpolated);
  let min = Infinity, max = -Infinity, sum = 0, cnt = 0;
  for (let i = 1; i < visSamples.length; i++) {
    const dt = (new Date(visSamples[i].t) - new Date(visSamples[i - 1].t)) / 1000;
    if (dt < min) min = dt;
    if (dt > max) max = dt;
    sum += dt; cnt++;
  }
  return {
    avg: cnt > 0 ? sum / cnt : 0,
    min: isFinite(min) ? min : 0,
    max: isFinite(max) ? max : 0,
    rawCount: orig.length,
    interpCount: visSamples.length - orig.length,
  };
}
