// MultiGlobe 相关纯函数（不依赖 React，只依赖 Cesium 与轨道数据）。
import { Cesium } from "./cesiumGlobal.js";
import { interpEciAtMs } from "../../sat/satmath.mjs";

// ---------------------------------------------------------------
// ICRF→Fixed 矩阵每帧缓存：computeIcrfToFixedMatrix 是重计算（岁差/章动），
// 且结果只取决于时刻。同一帧内卫星点共用同一时刻、LEO 组内跨轨道的采样
// 时间戳（now + k×stepMs）大量重复，按毫秒时间戳缓存可把每帧数十万次调用
// 降到数百次。缓存仅在单帧内有效，由 MultiGlobe 每帧 preUpdate 调 resetIcrfCache 清空。
// ---------------------------------------------------------------
const _MTX_CACHE_MAX = 4096; // 容量上限兜底：超限整体清空，防止长时间运行无限膨胀
let _mtxCache = new Map();   // key=整数毫秒时间戳，value=Matrix3（null 表示该时刻矩阵不可得）

/** 清空 ICRF→Fixed 矩阵缓存（每帧开始调用，保证跨帧不残留过期矩阵）。 */
export function resetIcrfCache() {
  _mtxCache.clear();
}

/** 取指定毫秒时刻的 ICRF→Fixed 矩阵（带每帧缓存）；不可得时返回 null（同样缓存，避免重复失败计算）。 */
function icrfMatrix(dateMs) {
  if (_mtxCache.has(dateMs)) return _mtxCache.get(dateMs);
  if (_mtxCache.size >= _MTX_CACHE_MAX) _mtxCache.clear();
  const jd = Cesium.JulianDate.fromDate(new Date(dateMs));
  const m = Cesium.Transforms.computeIcrfToFixedMatrix(jd) || null;
  _mtxCache.set(dateMs, m);
  return m;
}

// ECI(km) → ECEF 地心坐标（米），基于指定显示时刻的 ICRF→Fixed 矩阵（纯函数，不依赖 viewer）
// date 可传 Date 或整数毫秒时间戳（后者供轨道线逐点调用，省去 new Date 分配）。
export function eciToEcef(eci, date) {
  const dateMs = typeof date === "number" ? date : date.getTime();
  const m = icrfMatrix(dateMs);
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
//
// P2 节流（可选，含轻微视觉取舍）：轨道环整体形状随时间缓慢变化，无需每帧重算。
// 传入 cache 对象时按「模拟时间」节流——环锚点最多滞后卫星 ORBIT_LINE_SIM_STEP_MS 的模拟时间
// （LEO 约 0.25°，肉眼不可辨）：暂停/低速时几乎不重算（大幅省算力），高速时自动每帧更新以跟手。
// 不传 cache（或把阈值设为 0）则每帧精确重算，视觉零取舍。cache 生命周期与单条轨道线实体一致（见 useOrbitLines）。
export const ORBIT_LINE_SIM_STEP_MS = 4000;

export function orbitLinePositions(o, viewer, inertial, cache) {
  const now = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
  // 节流命中：同一轨道数据 + 同一坐标系 + 模拟时间推进不足阈值 → 直接复用上次环坐标
  if (
    cache &&
    cache.cacheRef === o.cache &&
    cache.inertial === inertial &&
    Math.abs(now - cache.now) < ORBIT_LINE_SIM_STEP_MS
  ) {
    return cache.positions;
  }
  const positions = o.cache.samples.map((s) => {
    const t = now + s.dt;
    const eci = interpEciAtMs(o.cache, t);
    const T = inertial ? now : t; // 仅坐标系不同：惯性同刻（空间环）、地固各自时刻（地表轨迹）
    return eciToEcef(eci, T); // 传毫秒时间戳：命中每帧矩阵缓存，省去 new Date 分配
  });
  if (cache) {
    cache.now = now;
    cache.positions = positions;
    cache.cacheRef = o.cache;
    cache.inertial = inertial;
  }
  return positions;
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
