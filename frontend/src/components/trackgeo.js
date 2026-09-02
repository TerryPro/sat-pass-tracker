// 轨迹几何工具（OpenLayers）：日期线封口、按圈拆分轨迹、轨迹样式、卫星高度反算、可视范围
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import { Stroke, Style } from "ol/style";
import { mapIsDark } from "./mapStyles.js";
// 可视范围（覆盖圆）的球面几何为纯函数，提取到 footprint.js 供 OpenLayers 与 Cesium 共用
export { computeFootprint } from "./footprint.js";

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

