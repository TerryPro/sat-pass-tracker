// 卫星点渲染：PointPrimitiveCollection + 名字标签集合。
// 容量未变时原地更新（位置/高亮），仅换组或点数变化才重建集合；
// 位置由 Cesium 时钟 onTick 每帧用最新时刻同步（与轨道线同帧同时刻，避免高倍速下 React 状态滞后脱轨）。
import { useEffect, useRef } from "react";
import { Cesium } from "./cesiumGlobal.js";
import { addPoint, eciToEcef, normalColor, selectedColor } from "./globeUtils.js";

export function useSatellitePoints({
  viewerRef, state,
  positions, displayDate, highlightNorad, inertialRef, getPositionsAt, showNames,
  pointsRef, noradToPointRef, pointsCollectionRef, labelsCollectionRef, noradToLabelRef, lastCountRef,
}) {
  const showNamesRef = useRef(showNames);
  showNamesRef.current = showNames;
  const getPositionsAtRef = useRef(getPositionsAt);
  getPositionsAtRef.current = getPositionsAt;

  // 时钟每帧：按最新时刻同步卫星点/标签位置（与轨道线同帧同时刻）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    const listener = (clock) => {
      const d = Cesium.JulianDate.toDate(clock.currentTime);
      const gp = getPositionsAtRef.current;
      if (gp && pointsCollectionRef.current) {
        for (const p of gp(d)) {
          const pt = noradToPointRef.current[p.norad];
          if (pt && p.isValid && isFinite(p.eci.x)) pt.position = eciToEcef(p.eci, d);
          const lab = noradToLabelRef.current[p.norad];
          if (lab && p.isValid && isFinite(p.eci.x)) lab.position = eciToEcef(p.eci, d);
        }
      }
    };
    viewer.clock.onTick.addEventListener(listener);
    return () => {
      const v = viewerRef.current;
      if (v && v.clock) v.clock.onTick.removeEventListener(listener);
    };
  }, [viewerRef, state, pointsCollectionRef, noradToPointRef, noradToLabelRef]);

  // 点集合渲染：容量未变时原地更新（位置/高亮），仅换组或点数变化才重建集合
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready" || !displayDate) return;
    // 惯性系下用 Cesium 时钟（与相机惯性变换同帧同源），避免 React 状态一帧滞后导致抵消不彻底、轨道抖动；
    // 地固系用显示时刻即可
    const tm = inertialRef.current
      ? Cesium.JulianDate.toDate(viewer.clock.currentTime)
      : displayDate;
    const primitives = viewer.scene.primitives;
    let coll = pointsCollectionRef.current;
    if (!coll) {
      coll = new Cesium.PointPrimitiveCollection();
      pointsCollectionRef.current = coll;
      primitives.add(coll);
    }
    const valid = positions.filter((p) => p && p.eci && p.isValid && isFinite(p.eci.x));
    const countChanged = valid.length !== lastCountRef.current;

    if (countChanged) {
      // 重建集合（换组/数量变化）
      primitives.remove(coll);
      coll.destroy();
      coll = new Cesium.PointPrimitiveCollection();
      pointsCollectionRef.current = coll;
      primitives.add(coll);
      noradToPointRef.current = {};
      pointsRef.current = [];
      for (const p of valid) {
        const pt = addPoint(coll, p, tm, p.norad === highlightNorad);
        noradToPointRef.current[p.norad] = pt;
        pointsRef.current.push(pt);
      }
      // 标签集合跟随重建：showNames 控制可见性
      const oldLc = labelsCollectionRef.current;
      if (oldLc) { primitives.remove(oldLc); oldLc.destroy(); labelsCollectionRef.current = null; }
      noradToLabelRef.current = {};
      const lc = new Cesium.LabelCollection();
      labelsCollectionRef.current = lc;
      primitives.add(lc);
      for (const p of valid) {
        const pt = noradToPointRef.current[p.norad];
        const lab = lc.add({
          position: Cesium.Cartesian3.clone(pt.position),
          text: p.name,
          font: "12px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          // 0 = 深度测试：地球背面（被遮挡）的卫星名字不显示，与卫星点一致
          disableDepthTestDistance: 0,
        });
        noradToLabelRef.current[p.norad] = lab;
      }
      lc.show = showNamesRef.current;
      lastCountRef.current = valid.length;
      return;
    }

    // 原地更新：仅改高亮颜色/尺寸；位置由 onTick 每帧用最新时钟时刻同步（避免旧时刻覆盖）
    const seen = new Set();
    for (const p of valid) {
      let pt = noradToPointRef.current[p.norad];
      if (!pt) { // 兜底：理论上容量未变不会触发，稳妥起见增量补齐
        pt = addPoint(coll, p, tm, p.norad === highlightNorad);
        noradToPointRef.current[p.norad] = pt;
        pointsRef.current.push(pt);
      }
      const sel = p.norad === highlightNorad;
      pt.pixelSize = sel ? 8 : 4;
      pt.color = sel ? selectedColor() : normalColor();
      seen.add(p.norad);
    }
    // 移除已不在集合中的点
    for (let i = pointsRef.current.length - 1; i >= 0; i--) {
      const pt = pointsRef.current[i];
      if (!seen.has(pt.id)) {
        coll.remove(pt);
        delete noradToPointRef.current[pt.id];
        pointsRef.current.splice(i, 1);
      }
    }
  }, [viewerRef, state, positions, displayDate, highlightNorad, inertialRef,
      pointsRef, noradToPointRef, pointsCollectionRef, labelsCollectionRef, noradToLabelRef, lastCountRef]);

  // 「卫星名字」开关：仅切换标签集合可见性（集合随点集合同生命周期，避免反复创建/销毁）
  useEffect(() => {
    const lc = labelsCollectionRef.current;
    if (lc) lc.show = showNames;
  }, [showNames, state, labelsCollectionRef]);
}
