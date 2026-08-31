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
    if (!pos || typeof pos.x !== "number" || !isFinite(pos.x)
        || !isFinite(pos.y) || !isFinite(pos.z)) {
      return { x: 0, y: 0, z: 0, isValid: false };
    }
    return { x: pos.x, y: pos.y, z: pos.z, isValid: true };
  } catch (_) {
    return { x: 0, y: 0, z: 0, isValid: false };
  }
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
      if (p && typeof p.x === "number" && isFinite(p.x) && isFinite(p.y) && isFinite(p.z)) {
        pts.push({ t: ms, eci: { x: p.x, y: p.y, z: p.z } });
      }
    }
  } catch (_) {
    /* 忽略单点失败 */
  }
  return pts;
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
