// MultiGlobe 相关纯函数（不依赖 React，只依赖 Cesium 与轨道数据）。
import { Cesium } from "./cesiumGlobal.js";
import { interpEciAtMs } from "../../sat/satmath.mjs";

// ECI(km) → ECEF 地心坐标（米），基于指定显示时刻的 ICRF→Fixed 矩阵（纯函数，不依赖 viewer）
export function eciToEcef(eci, date) {
  const jd = Cesium.JulianDate.fromDate(date);
  const m = Cesium.Transforms.computeIcrfToFixedMatrix(jd);
  const cart = Cesium.Cartesian3.fromElements(eci.x * 1000, eci.y * 1000, eci.z * 1000);
  if (!m) return cart; // 矩阵不可得时退回把 ECI 当 ECEF（极少见）
  return Cesium.Matrix3.multiplyByVector(m, cart, new Cesium.Cartesian3());
}

// 统一轨道线位置（2D/3D × 地固/惯性共用）：
//   轨道数据 = 从「当前时刻」起一整圈卫星轨道（cache.samples，SGP4 整圈，含进动）；
//   仅坐标系不同 → 转换时刻 T 不同：
//     - 惯性（ICRF）：T = 当前时刻（整圈同一时刻转换 → 空间轨道环，相机抵消后相对星空固定）
//     - 地固（ECEF）：T = 当前时刻 + 采样偏移（各点各自时刻 → 卫星相对地球的整圈轨迹）
//   dt=0 的点（T=now）即卫星当前位置，轨道线始终经过卫星。
export function orbitLinePositions(o, viewer, inertial) {
  const now = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
  return o.cache.samples.map((s) => {
    const t = now + s.dt;
    const eci = interpEciAtMs(o.cache, t);
    const T = inertial ? now : t; // 仅坐标系不同：惯性同刻（空间环）、地固各自时刻（地表轨迹）
    return eciToEcef(eci, new Date(T));
  });
}

// 卫星点配色：Cesium 惰性加载，需在函数内按需获取而非模块顶层求值（否则加载前抛错）
// 用模块级缓存复用颜色对象，避免每帧重建
let _normal = null;
let _selected = null;
export function normalColor() { return (_normal ||= Cesium.Color.fromCssColorString("rgba(63,200,255,0.9)")); }
export function selectedColor() { return (_selected ||= Cesium.Color.ORANGE); }

// 向集合添加一个卫星点，返回该 primitive（供重建/兜底新增共用）
export function addPoint(coll, p, date, sel) {
  return coll.add({
    position: eciToEcef(p.eci, date),
    pixelSize: sel ? 8 : 4,
    color: sel ? selectedColor() : normalColor(),
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 1,
    id: p.norad,
    // 0 = 始终启用深度测试：让地球遮挡背面的卫星点（保留 disableDepthTestDistance 字段以便后续调整）
    disableDepthTestDistance: 0,
  });
}
