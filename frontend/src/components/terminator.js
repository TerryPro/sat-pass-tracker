// 晨昏线（日/夜分界）天文计算。
// 太阳赤纬 δ 与日下点经度 λs 由 UTC 时间近似求得（忽略均时差，可视化足够）。
// 晨昏线是"距日下点 90°"的大圆，其纬度 φ 随经度 λ 的变化由：
//     sinδ·sinφ + cosδ·cosφ·cos(λ-λs) = 0   ⇒   φ = atan(-cos(λ-λs) / tanδ)

export function sunPosition(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const n = (date.getTime() - start) / 86400000; // 日序（含小数，1 月 1 日约为 1）
  const decl = 23.44 * Math.sin((2 * Math.PI / 365.24) * (284 + n)); // 度
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // UTC 12:00 太阳位于 0° 经线正上方，其后每小时西移 15°
  const sunLon = (12 - utcHours) * 15; // 度，向东为正
  return { decl, sunLon };
}

// 给定太阳赤纬与日下点经度，求经度 lonDeg 处的晨昏线纬度（度，∈[-90, 90]）
export function terminatorLat(declDeg, sunLonDeg, lonDeg) {
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const tanD = Math.tan(declDeg * D2R);
  // 春/秋分 tanD≈0 时晨昏线退化为过两极的经线（φ→±90），用极小值避免除零
  const safeTan = Math.abs(tanD) < 1e-8 ? (tanD < 0 ? -1e-8 : 1e-8) : tanD;
  const h = (lonDeg - sunLonDeg) * D2R; // 时角
  return Math.atan(-Math.cos(h) / safeTan) * R2D;
}
