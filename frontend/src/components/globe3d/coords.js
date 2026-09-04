// globe3d 子模块：Cesium 坐标换算与常量（纯函数，可独立测试）
// Cesium 通过 cesiumGlobal 惰性代理访问（运行时已加载），避免静态打包。
import { Cesium } from "./cesiumGlobal.js";

// 地球半径（km）
export const EARTH_RADIUS_KM = 6371;

// 卫星默认轨道高度（km）：无实时/过境数据时估算地面站通视半径用
export const SAT_DEFAULT_ALT = { iss: 420, css: 400 };

// 经纬度 + 高度(km) → Cesium 地心坐标（高度单位转米）
export function llh(lon, lat, altKm) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, (altKm || 0) * 1000);
}

// 惯性视角坐标换算：把"采样时刻 tIso 的 ECEF 位置"换算成"当前场景显示时刻的 ECEF 坐标"。
// 语义：该点在惯性系（ICRF）中固定，显示时随当前 clock 时刻旋转——与惯性相机一致，
// 从而呈现"轨道面不动、地球自转"；若当前时刻等于采样时刻，则还原为该点的地表/空间位置。
export function inertialDisplay(viewer, tIso, lon, lat, altKm) {
  if (!viewer) return llh(lon, lat, altKm);
  const mNow = Cesium.Transforms.computeIcrfToFixedMatrix(
    Cesium.JulianDate.fromDate(new Date(tIso))
  );
  const mCur = Cesium.Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime);
  if (!mNow || !mCur) return llh(lon, lat, altKm);
  const fixed = llh(lon, lat, altKm);
  const mt = Cesium.Matrix3.transpose(mNow, new Cesium.Matrix3());
  const inertial = Cesium.Matrix3.multiplyByVector(mt, fixed, new Cesium.Cartesian3());
  return Cesium.Matrix3.multiplyByVector(mCur, inertial, new Cesium.Cartesian3());
}
