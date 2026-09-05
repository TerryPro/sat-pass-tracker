// 多星轨道计算：用 satellite.js(SGP4)在浏览器端将一组 TLE 解析为星下点/ECI 位置。
// provider: /api/library/entries 给出 { norad_id, name, tle1, tle2 } 的 TLE 列表。
// 说明：
//   - twoline2satrec 解析 TLE → satrec（可缓存，repeat 复用）。
//   - propagate(satrec, date) 得 ECI 位置，eciToGeodetic + gstime 得地表经纬度/高度。
//   - 播放推进时仅对"被跟踪的子集"（通常几十颗）重算，避免每帧全组 SGP4 卡顿。
import { twoline2satrec, propagate, eciToGeodetic, gstime } from "satellite.js";

// 生成全部星下点的运行时上限（超过则分批/截断，避免单帧卡顿）
export const MAX_ALL_PINS = 800;

export function parseTle(tle1, tle2) {
  // twoline2satrec(line1, line2)
  return twoline2satrec(tle1, tle2);
}

/**
 * 把一组 { norad_id, name, tle1, tle2 } 解析成 { norad, name, satrec }，跳过解析失败项。
 * satrec 可缓存复用，避免每次重 parse。
 */
export function buildSatRecords(entries) {
  const out = [];
  for (const e of entries || []) {
    try {
      const satrec = parseTle(e.tle1, e.tle2);
      out.push({ norad: e.norad_id, name: e.name || String(e.norad_id), satrec });
    } catch (_) {
      // 无效 TLE 跳过
    }
  }
  return out;
}

/**
 * 计算一组 satrec 在指定时刻的星下点。
 * @param {Array<{norad,name,satrec}>} sats
 * @param {Date} date
 * @param {number} limit 最多返回几颗（超限截断）
 * @returns {Array<{norad,name,lat,lon,altKm,isValid}>}
 */
export function subpointsAtTime(sats, date, limit = MAX_ALL_PINS) {
  const list = limit > 0 ? sats.slice(0, limit) : sats;
  return list.map((s) => subpoint(s, date));
}

/** 单颗星在指定时刻的星下点 */
export function subpoint(s, date) {
  try {
    const pos = propagate(s.satrec, date).position; // {x,y,z} ECI km
    if (!pos || typeof pos.x !== "number" || !isFinite(pos.x)) {
      return { norad: s.norad, name: s.name, lat: NaN, lon: NaN, altKm: NaN, isValid: false };
    }
    const gmst = gstime(date);
    const geo = eciToGeodetic(pos, gmst);
    return {
      norad: s.norad,
      name: s.name,
      lat: geo.latitude,
      lon: geo.longitude,
      altKm: geo.height,
      isValid: true,
    };
  } catch (_) {
    return { norad: s.norad, name: s.name, lat: NaN, lon: NaN, altKm: NaN, isValid: false };
  }
}

/** ECI 位置（可选，供 Cesium 画空间点） */
export function eciPosition(s, date) {
  try {
    const pos = propagate(s.satrec, date).position;
    return { x: pos.x, y: pos.y, z: pos.z, isValid: true };
  } catch (_) {
    return { x: 0, y: 0, z: 0, isValid: false };
  }
}

/**
 * 轨道要素（由 SGP4 平均根数 satrec 解析）：
 * 倾角/升交点赤经/近地点幅角（度）、偏心率、轨道周期（分）、近地点/远地点高度（km）。
 */
export function orbitElements(satrec) {
  const mu = 398600.8; // 地球引力常数 km³/s²
  const nRadMin = satrec.no || 0; // satellite.js：no 为平均运动（rad/min）
  const nRadSec = nRadMin / 60;   // rad/s
  const a = nRadSec ? Math.cbrt(mu / (nRadSec * nRadSec)) : 0; // 半长轴 km
  const e = satrec.ecco || 0;
  const Re = 6378.137; // WGS84 赤道半径 km
  return {
    inclDeg: (satrec.inclo || 0) * (180 / Math.PI),
    raanDeg: (satrec.nodeo || 0) * (180 / Math.PI),
    argpDeg: (satrec.argpo || 0) * (180 / Math.PI),
    ecc: e,
    periodMin: nRadMin ? (2 * Math.PI) / nRadMin : 0,
    perigeeKm: a * (1 - e) - Re,
    apogeeKm: a * (1 + e) - Re,
  };
}

/** 某时刻的速度标量（km/s） */
export function speedAt(satrec, date) {
  try {
    const v = propagate(satrec, date).velocity;
    if (v && typeof v.x === "number" && isFinite(v.x)) {
      return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }
  } catch (_) {}
  return null;
}

/**
 * 批量计算一组 satrec 在指定时刻的 ECI 位置（悬浮轨道上，非星下点）。
 * @returns {Array<{ norad, name, eci:{x,y,z}, isValid }>}
 */
export function eciPositionsAtTime(sats, date, limit = MAX_ALL_PINS) {
  const list = limit > 0 ? sats.slice(0, limit) : sats;
  return list.map((s) => {
    const p = eciPosition(s, date);
    return { norad: s.norad, name: s.name, eci: { x: p.x, y: p.y, z: p.z }, isValid: p.isValid };
  });
}

/**
 * 预采样某颗星的 ECI 位置序列（供 Cesium 画空间轨道线）。
 * @returns {Array<{ t:number, eci:{x,y,z} }>} t 为距 start 秒
 */
export function sampleEci(s, start, minutes, stepSec) {
  const pts = [];
  const totalMs = minutes * 60 * 1000;
  try {
    for (let ms = 0; ms <= totalMs; ms += stepSec * 1000) {
      const p = propagate(s.satrec, new Date(start.getTime() + ms)).position;
      if (p && typeof p.x === "number" && isFinite(p.x)) {
        pts.push({ t: ms, eci: { x: p.x, y: p.y, z: p.z } });
      }
    }
  } catch (_) {
    /* 忽略单点失败 */
  }
  return pts;
}

/**
 * 一次性预采样一组卫星的「整圈」ECI 轨道，并记录轨道周期与起点时刻。
 * 播放/拖动时用 interpEciAtMs 插值取位，避免每帧对全组跑 SGP4（参考 satvis 的"烘焙轨道"思路）。
 * @param {Array<{norad,name,satrec}>} sats
 * @param {Date} start 采样起点（一般取当前时刻）
 * @param {number} stepSec 采样步长（秒），默认 60
 * @param {number} limit 最多缓存几颗（超限截断，控内存）
 * @returns {Array<{norad,name,refT,periodMs,stepMs,samples}>}
 *   samples: [{ dt, eci:{x,y,z} }]，dt 为相对 start 的毫秒数
 */
export function buildOrbitCache(sats, start, stepSec = 60, limit = MAX_ALL_PINS) {
  const refT = start.getTime();
  const out = [];
  // 每圈采样点上限：GEO（24h 周期）若固定 60s 步长会采 1441 点/颗，800 颗直接爆炸，
  // 这里按周期自适应加大步长，保证每圈 ≤ MAX_SAMPLES 点（LEO 仍约 60s/点）
  const MAX_SAMPLES = 256;
  for (const s of sats || []) {
    // satellite.js v6 未暴露 period，由平均角速度 satrec.no(rad/min) 推算轨道周期
    const periodMs = (s.satrec.no ? (Math.PI * 2) / s.satrec.no : 90) * 60000;
    let stepMs = stepSec * 1000;
    if (periodMs / stepMs > MAX_SAMPLES) stepMs = Math.ceil(periodMs / MAX_SAMPLES);
    const steps = Math.ceil(periodMs / stepMs);
    const samples = [];
    let ok = true;
    for (let i = 0; i <= steps; i++) {
      const p = propagate(s.satrec, new Date(refT + i * stepMs)).position;
      if (p && typeof p.x === "number" && isFinite(p.x)) {
        samples.push({ dt: i * stepMs, eci: { x: p.x, y: p.y, z: p.z } });
      } else {
        ok = false;
        break;
      }
    }
    if (ok && samples.length >= 2) {
      out.push({ norad: s.norad, name: s.name, refT, periodMs, stepMs, samples });
    }
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 用轨道缓存求某颗星在任意时刻的 ECI 位置，写入复用出参 out（线性插值，绕周期取模，闭环无缝）。
 * 供每帧热路径原地更新，避免新建 {x,y,z} 对象（GC 压力）。
 * @param {ReturnType<typeof buildOrbitCache>[number]} cache
 * @param {number} ms 目标时刻（毫秒时间戳）
 * @param {{x:number,y:number,z:number}} out 复用出参对象
 * @returns {{x,y,z}} out（原对象，便于链式使用）
 */
export function interpEciInto(cache, ms, out) {
  const periodMs = cache.periodMs;
  const offset = ((ms - cache.refT) % periodMs + periodMs) % periodMs;
  const stepMs = cache.stepMs;
  const i0 = Math.floor(offset / stepMs);
  const a = Math.min(i0, cache.samples.length - 1);
  const b = a + 1 >= cache.samples.length ? 0 : a + 1;
  const s0 = cache.samples[a];
  const s1 = cache.samples[b];
  const frac = (offset - a * stepMs) / stepMs;
  out.x = s0.eci.x + (s1.eci.x - s0.eci.x) * frac;
  out.y = s0.eci.y + (s1.eci.y - s0.eci.y) * frac;
  out.z = s0.eci.z + (s1.eci.z - s0.eci.z) * frac;
  return out;
}

/**
 * 用轨道缓存求某颗星在任意时刻的 ECI 位置（返回新对象）。
 * 非热路径调用；每帧热路径请用 interpEciInto 复用出参避免分配。
 * @param {ReturnType<typeof buildOrbitCache>[number]} cache
 * @param {number} ms 目标时刻（毫秒时间戳）
 * @returns {{x,y,z}}
 */
export function interpEciAtMs(cache, ms) {
  return interpEciInto(cache, ms, { x: 0, y: 0, z: 0 });
}

/**
 * 预采样某颗星的星下点（供轨道线/时间推进查表）。
 * @param satrec
 * @param {Date} start
 * @param {number} minutes
 * @param {number} stepSec
 * @returns {Array<{t:number, lat, lon, altKm}>} t 为距 start 秒
 */
export function sampleSubpoint(s, start, minutes, stepSec) {
  const pts = [];
  const totalMs = minutes * 60 * 1000;
  try {
    const gmst0 = gstime(start);
    for (let ms = 0; ms <= totalMs; ms += stepSec * 1000) {
      const date = new Date(start.getTime() + ms);
      const pos = propagate(s.satrec, date).position;
      if (!pos) continue;
      const gmst = gmst0 + (ms / 1000) * 0.004375; // 小步近似，够用；精确可用 gstime(date)
      // 精确起见用 gstime(date)
      const geo = eciToGeodetic(pos, gstime(date));
      pts.push({ t: ms, lat: geo.latitude, lon: geo.longitude, altKm: geo.height });
    }
  } catch (_) {
    /* 忽略单点失败 */
  }
  return pts;
}
