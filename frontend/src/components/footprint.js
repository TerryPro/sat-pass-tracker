// 卫星可视范围（覆盖圆 / 地面站通视圆）的球面几何（纯函数，不依赖任何渲染库）。
// 供 OpenLayers 2D（trackgeo.js）与 Cesium（globe3d/render.js）共用同一套数学，
// 保证两引擎的可视范围几何一致。

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

// 覆盖圆触及/越过北(或镜像后的南)极时，构造"下弧 + 顶部 maxLat 封口"的闭合环。
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
