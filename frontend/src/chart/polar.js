// 极坐标映射工具：
//
//   * ECharts 极坐标数据顺序是 [半径, 角度]（不是 [角度, 半径]）
//   * 半径 r = 90 - el   → el=0° 地平线在最外圈 r=90，el=90° 天顶在中心 r=0
//   * 角度 a = 90 - az   → 0° 在东侧、逆时针增大，正北(N)在正上方
//   * angleAxis: startAngle=0, clockwise=false；刻度 0=E, 90=N, 180=W, 270=S

// 方位角连续化（处理跨 0°/360° 边界）
export function unwrapAz(azs) {
  if (!azs || azs.length === 0) return [];
  const out = [azs[0]];
  let off = 0;
  for (let i = 1; i < azs.length; i++) {
    const prev = azs[i - 1] - off * 360;
    let cur = azs[i];
    const delta = cur - prev;
    if (delta > 180) { cur -= 360; off++; }
    else if (delta < -180) { cur += 360; off--; }
    out.push(cur);
  }
  return out;
}

// 径向值：仰角 → 半径（el=0 → 90 外圈，el=90 → 0 中心）
export const r = (el) => Math.max(0, Math.min(90, 90 - el));
// 角度值：方位角 → 极坐标角（az=0(N)→90°，az=90(E)→0°）
export const a = (az) => 90 - az;

// 极坐标角 → 方位角（tooltip 反算用）
export function angleToAz(ang) {
  return (((90 - ang) % 360) + 360) % 360;
}
// 半径 → 仰角（tooltip 反算用）
export const r2el = (rv) => Math.max(0, Math.min(90, 90 - rv));
