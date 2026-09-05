// 轨道线 entities：普通轨道线 + 选中星高亮轨道线。
// 只在「结构」变化（颗数/总开关/坐标系/颜色）时重建；轨道数据（父级 60s 重采样体现 J2 进动）
// 经 orbitsMapRef 每帧读取，避免重建实体闪烁。位置由 CallbackProperty 按当前时钟时刻计算。
import { useEffect, useMemo, useRef } from "react";
import { Cesium } from "./cesiumGlobal.js";
import { orbitLinePositions } from "./globeUtils.js";

export function useOrbitLines({
  viewerRef, state,
  orbits, orbitColor, highlightNorad, inertialRef,
  orbitEntitiesRef, highlightOrbitRef,
}) {
  const orbitsMapRef = useRef(new Map());
  orbitsMapRef.current = new Map(orbits.map((o) => [o.norad, o]));
  // 结构 key：仅 norad 列表（重采样不改变结构 → 不重建；数据变化由回调读 ref 生效）
  const orbitKey = useMemo(() => orbits.map((o) => o.norad).join("|"), [orbits]);

  // 普通轨道线
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    orbitEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    orbitEntitiesRef.current = [];
    if (!orbitsMapRef.current.size) return;
    orbitsMapRef.current.forEach((o) => {
      if (!o.cache || o.cache.samples.length < 2) return;
      // 每条轨道线独立的节流缓存（生命周期与实体一致）：按模拟时间节流重算，见 globeUtils.ORBIT_LINE_SIM_STEP_MS
      const lineCache = { now: NaN, positions: null, cacheRef: null, inertial: null };
      const e = viewer.entities.add({
        polyline: {
          // 统一算法（见 globeUtils.orbitLinePositions）：仅坐标系决定转换时刻
          positions: new Cesium.CallbackProperty(
            () => orbitLinePositions(o, viewer, inertialRef.current, lineCache),
            false
          ),
          width: 1,
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(orbitColor)) },
      });
      orbitEntitiesRef.current.push(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRef, state, orbitKey, orbitColor, inertialRef, orbitEntitiesRef]);

  // 选中星轨道高亮：叠加同宽、高亮颜色的轨道线作标识（不加粗），
  // 取消选中或结构变化时移除；避免因高亮重建全部轨道线实体
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    if (highlightOrbitRef.current) {
      viewer.entities.remove(highlightOrbitRef.current);
      highlightOrbitRef.current = null;
    }
    if (highlightNorad == null) return;
    const cur = orbitsMapRef.current.get(highlightNorad);
    if (!cur) return;
    // 高亮轨道线独立节流缓存（与普通轨道线一致）
    const hlCache = { now: NaN, positions: null, cacheRef: null, inertial: null };
    highlightOrbitRef.current = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => orbitLinePositions(cur, viewer, inertialRef.current, hlCache),
          false
        ),
        width: 1, // 与普通轨道线同宽，仅用颜色区分（不加粗）
        material: new Cesium.ColorMaterialProperty(
          Cesium.Color.fromCssColorString("rgba(255,90,90,0.95)")),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRef, state, highlightNorad, orbitKey, inertialRef, highlightOrbitRef]);
}
