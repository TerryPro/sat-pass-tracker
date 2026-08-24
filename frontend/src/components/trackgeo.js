// 轨迹几何工具（OpenLayers）：日期线封口、按圈拆分轨迹、轨迹样式、卫星高度反算、可视范围
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import { Stroke, Style } from "ol/style";
import { mapIsDark } from "./mapStyles.js";

// 单个 orbit 线段首尾封口：当端点贴近日期线（|lon|>160°）时，把端点沿其运动方向外插到
// ±180° 边界，使线段精确落在日期线上。这样 wrapX 世界副本下，圈与圈在 ±180° 处才能
// 无缝对齐，避免端点停在采样点（如 ±178°）造成的参差毛边/断点。
export function sealAntimeridianEnds(pts) {
  if (!pts || pts.length < 2) return pts;
  const THRESH = 160;
  const first = pts[0], second = pts[1];
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];

  // 把端点 a 用其内侧相邻点 b 的局部斜率，外插到经度 boundarySign*180 处
  const seal = (a, b, boundarySign) => {
    let dLon = b.lon - a.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const slope = dLon === 0 ? 0 : (b.lat - a.lat) / dLon;
    const targetLon = boundarySign * 180;
    return { lon: targetLon, lat: a.lat + slope * (targetLon - a.lon), t: a.t, orbit: a.orbit };
  };

  const out = [];
  if (Math.abs(first.lon) > THRESH) {
    out.push(seal(first, second, first.lon > 0 ? 1 : -1));
  }
  out.push(...pts);
  if (Math.abs(last.lon) > THRESH) {
    out.push(seal(last, prev, last.lon > 0 ? 1 : -1));
  }
  return out;
}

// 轨迹线渲染：
// - EPSG:4326：解包经度（允许 >180 或 <-180），交给 OpenLayers wrapX 在世界副本中连续渲染。
// - EPSG:3857：在 ±180° 边界处切分并插值边界点，配合 wrapX:true 在世界副本中衔接。
export function segmentAndBuildFeatures(pts, toMap, orbit, is4326) {
  const features = [];
  if (!pts || pts.length < 2) return features;
  // 首尾封口到日期线，消除日期线两侧的参差毛边/断点
  pts = sealAntimeridianEnds(pts);

  if (is4326) {
    // 解包：保证相邻点经度差不超过 180°，形成连续跨世界的 LineString
    const unwrapped = [{ ...pts[0] }];
    let offset = 0;
    for (let i = 1; i < pts.length; i++) {
      const delta = pts[i].lon - pts[i - 1].lon;
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
      unwrapped.push({ ...pts[i], lon: pts[i].lon + offset });
    }
    const f = new Feature(new LineString(unwrapped.map((p) => toMap(p.lon, p.lat))));
    f.set("orbit", Number(orbit));
    features.push(f);
    return features;
  }

  // 3857：切分 + 边界插值（fromLonLat 会把坐标归一化到 [-180,180]，不能直接用解包）
  const segs = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    if (cur.length && Math.abs(pts[i].lon - pts[i - 1].lon) > 180) {
      const prev = pts[i - 1];
      const next = pts[i];
      const distPrev = 180 - Math.abs(prev.lon);
      const distNext = 180 - Math.abs(next.lon);
      const ratio = distPrev / (distPrev + distNext);
      const boundaryLat = prev.lat + (next.lat - prev.lat) * ratio;
      const boundaryLon = prev.lon > 0 ? 180 : -180;
      cur.push({ lon: boundaryLon, lat: boundaryLat, t: prev.t, orbit: prev.orbit });
      segs.push(cur);
      cur = [{ lon: boundaryLon, lat: boundaryLat, t: next.t, orbit: next.orbit }];
    }
    cur.push(pts[i]);
  }
  if (cur.length) segs.push(cur);

  for (const seg of segs) {
    if (seg.length < 2) continue;
    const f = new Feature(new LineString(seg.map((p) => toMap(p.lon, p.lat))));
    f.set("orbit", Number(orbit));
    features.push(f);
  }
  return features;
}

// 轨迹线样式：统一单色（连续轨迹下不再按圈分色，避免 180° 接缝处的颜色跳变）。
// 暗色底图用亮蓝，亮色底图用深蓝保证对比度。
export function trackStyle() {
  const dark = mapIsDark();
  return new Style({
    stroke: new Stroke({
      color: dark ? "hsla(205, 85%, 62%, 0.7)" : "hsla(205, 90%, 35%, 0.85)",
      width: 2,
    }),
  });
}

// 由斜距 r_km + 仰角 el + 地面站海拔反算卫星相对平均海平面的高度（km）
export function satAltKm(rKm, elDeg, stationAltM) {
  const RE = 6371; // 地球平均半径 km
  const Rg = RE + (stationAltM || 0) / 1000; // 地面站到地心距离
  const el = ((elDeg || 0) * Math.PI) / 180;
  // 余弦定理：卫星地心距 ρ² = Rg² + r² + 2·Rg·r·sin(el)
  const rho = Math.sqrt(Rg * Rg + rKm * rKm + 2 * Rg * rKm * Math.sin(el));
  return rho - RE;
}

// 卫星可视范围（覆盖圆）：以星下点为中心、地心角 lam 为半径的球面小圆。
// 在纬度窗口 [-maxLatDeg, maxLatDeg] 内生成边界。当覆盖圆触及极区时，
// 直接用方位角采样会把"越过极点"的边界点反射回低纬（asin 主值）并翻转经度，
// 导致顶部"反向向低纬移动"。这里改为：触界时用经度参数化求出上/下分支纬度，
// 顶部/底部用 maxLat 封口，从而在投影里得到"延伸到地图边界"的正确形态。
// 返回环数组（通常 1 个），每个环为 [lon, lat] 闭合点序列。
export function computeFootprint(lat0, lon0, altKm, minElDeg = 0, stepDeg = 3, maxLatDeg = 90) {
  const RE = 6371;
  const D2R = Math.PI / 180;
  const elRad = minElDeg * D2R;
  // 地心半角：能看到卫星的最小仰角 minElDeg 对应的覆盖半径
  const lam = Math.acos((RE * Math.cos(elRad)) / (RE + altKm)) - elRad;
  const lamDeg = lam / D2R;
  const north = lat0 + lamDeg;
  const south = lat0 - lamDeg;

  // 完全落在纬度窗口内：普通闭合小圆
  if (south >= -maxLatDeg && north <= maxLatDeg) {
    return [{ ring: _circleRing(lat0, lon0, lam, stepDeg), collar: false }];
  }

  // 含北极 / 含南极：覆盖圆包含极点，须用经度参数化跨全经度构造（接缝封口）。
  // 返回 { ring, collar: true, boundaryArc }：ring 用于填充"全经度套环"，
  // boundaryArc 是覆盖圆真正的边界弧（南/北侧的小圆），用于单独描边——
  // 因为含极套环在 2D 投影里横跨整个经度，若给整个环描边，会在 ±180° 处出现竖线。
  if (north > 90) {
    const r = _cappedRing(lat0, lon0, lam, maxLatDeg, stepDeg);
    return r ? [{ ring: r.ring, collar: true, boundaryArc: r.boundaryArc }] : [];
  }
  if (south < -90) {
    const r = _cappedRing(-lat0, lon0, lam, maxLatDeg, stepDeg);
    return r
      ? [{
          ring: r.ring.map(([lo, la]) => [lo, -la]),
          collar: true,
          boundaryArc: r.boundaryArc.map(([lo, la]) => [lo, -la]),
        }]
      : [];
  }

  // 触界但未含极（顶部/底部超出纬度窗口）：方位角采样得到完整小圆，再裁剪纬度。
  // 方位角采样经度天然在 [-180,180]，不会被 atan2 主值以外的值弄乱。
  return [{ ring: _circleRingCapped(lat0, lon0, lam, stepDeg, maxLatDeg), collar: false }];
}

// 普通闭合小圆（未触界未含极）：方位角采样，lat 始终在窗口内
function _circleRing(lat0, lon0, lam, stepDeg) {
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const lat0R = lat0 * D2R;
  const lon0R = lon0 * D2R;
  const effStep = lam > (60 * D2R) ? Math.min(stepDeg, 1.5) : stepDeg;
  const n = Math.max(24, Math.round(360 / effStep));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const az = (i * (360 / n)) * D2R;
    const lat = Math.asin(
      Math.sin(lat0R) * Math.cos(lam) + Math.cos(lat0R) * Math.sin(lam) * Math.cos(az)
    );
    const lon =
      lon0R +
      Math.atan2(
        Math.sin(az) * Math.sin(lam) * Math.cos(lat0R),
        Math.cos(lam) - Math.sin(lat0R) * Math.sin(lat)
      );
    pts.push([lon * R2D, lat * R2D]);
  }
  pts.push(pts[0].slice()); // 闭合
  return pts;
}

// 触界未含极：完整小圆采样后，把纬度裁剪到 [-maxLatDeg, maxLatDeg]，顶部/底部变成平线
function _circleRingCapped(lat0, lon0, lam, stepDeg, maxLatDeg) {
  return _circleRing(lat0, lon0, lam, stepDeg).map(([lo, la]) => [
    lo,
    Math.min(maxLatDeg, Math.max(-maxLatDeg, la)),
  ]);
}

// 球冠边界在经度偏移 dLon 处的上/下分支纬度（弧度）。返回 null 表示该经度无交点。
function _capLat(lat0R, lam, dLon) {
  const A = Math.sin(lat0R);
  const B = Math.cos(lat0R) * Math.cos(dLon);
  const C = Math.cos(lam);
  const R = Math.sqrt(A * A + B * B);
  if (R < C) return null; // 该经度无交点（球冠不覆盖此经度）
  const alpha = Math.atan2(B, A);
  const base = Math.asin(Math.min(1, C / R));
  return {
    south: base - alpha,          // 南分支（= lat0 - lam 方向）
    north: Math.PI - base - alpha, // 北分支（= lat0 + lam 方向）
  };
}

// 覆盖圆触及/越过北(或镜像后的北)极时，构造"下弧 + 顶部 maxLat 封口"的闭合环。
function _cappedRing(lat0, lon0, lam, maxLatDeg, stepDeg) {
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const lat0R = lat0 * D2R;
  const sinLat0 = Math.sin(lat0R);
  const cosLat0 = Math.cos(lat0R);
  // c2 > 0 表示球冠未含极（最东/西点经度偏移 Δe 存在）；c2 < 0 表示含极（覆盖全经度）
  const c2 = (Math.cos(lam) * Math.cos(lam) - sinLat0 * sinLat0) / (cosLat0 * cosLat0);
  const coversPole = c2 < 0;
  const dE = coversPole
    ? null
    : Math.acos(Math.min(1, Math.max(-1, Math.sqrt(c2)))) * R2D;
  // 含极：覆盖全经度，采样固定在标准单世界 [-180, 180]；未含极：采样 [lon0-Δe, lon0+Δe]
  const lo = coversPole ? -180 : lon0 - dE;
  const hi = coversPole ? 180 : lon0 + dE;
  const span = hi - lo;
  const n = Math.max(24, Math.round(span / Math.min(stepDeg, 1.5)));
  const southPts = [];
  const northPts = [];
  for (let i = 0; i <= n; i++) {
    const lonDeg = lo + (i / n) * span;
    const dLon = (lonDeg - lon0) * D2R;
    const c = _capLat(lat0R, lam, dLon);
    if (!c) continue;
    // 南北分支都钳到纬度窗口，含极时两端超过 maxLat 的部分由顶部封口承接
    southPts.push([lonDeg, Math.min(maxLatDeg, Math.max(-maxLatDeg, c.south * R2D))]);
    northPts.push([lonDeg, Math.min(maxLatDeg, Math.max(-maxLatDeg, c.north * R2D))]);
  }
  if (southPts.length < 2) return null;
  // 闭合环：南弧（西→东）+ 北弧（东→西）
  const ring = [...southPts, ...[...northPts].reverse()];
  // 去重相邻点并闭合
  const clean = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i];
    const q = clean[clean.length - 1];
    if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6) continue;
    clean.push(p);
  }
  if (clean.length > 2) {
    const a = clean[0];
    const b = clean[clean.length - 1];
    if (Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] - b[1]) > 1e-6) clean.push(a);
  }
  // boundaryArc：覆盖圆真正的边界弧（远离极的一侧），供含极套环单独描边用
  return { ring: clean, boundaryArc: southPts };
}
