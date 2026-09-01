// 时钟与时间轴控制：Cesium 时间控件（timeline/animation）UTC/本地格式化、
// 时间轴无限扩展、onTick 相机跟踪选中星与 onTimeChange 同步。
import { useEffect, useRef } from "react";
import { Cesium } from "./cesiumGlobal.js";

export function useClockControls({
  viewerRef, state, timeDisplay,
  onTimeChange, trackSat, highlightNorad, inertialRef, noradToPointRef,
}) {
  // 最新回调经 ref 读取，避免因 props 变化重建 onTick listener
  const onTimeChangeRef = useRef(onTimeChange);
  onTimeChangeRef.current = onTimeChange;
  const trackSatRef = useRef(trackSat);
  trackSatRef.current = trackSat;
  const highlightNoradRef = useRef(highlightNorad);
  highlightNoradRef.current = highlightNorad;
  // 跟踪开启前的相机状态（用于关闭/失效时完全还原视角：位置 + 朝向）
  const trackRestoreRef = useRef(null);

  // Cesium 自带时间控件（timeline / animation）的文本固定按 UTC 格式化，按设置覆盖为本地/UTC
  // 注意：Cesium 1.144 Timeline 用 makeLabel(time)（硬编码 UTC），需覆盖实例方法；
  // Animation 控件用 animationViewModel.timeFormatter/dateFormatter。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    const local = timeDisplay === "local";
    const p = (n) => String(n).padStart(2, "0");
    const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
    const fmtTime = (d) => `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const fmtTimeUTC = (d) => `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    if (viewer.timeline) {
      viewer.timeline.makeLabel = function (time) {
        const d = Cesium.JulianDate.toDate(time);
        const ms = d.getMilliseconds();
        let msStr = local ? "" : " UTC";
        if (ms > 0) msStr = `.${String(ms).padStart(3, "0")}`;
        if (local) {
          return `${monthNames[d.getMonth()]} ${d.getDate()} ${d.getFullYear()} ${fmtTime(d)}${msStr}`;
        }
        return `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()} ${fmtTimeUTC(d)}${msStr}`;
      };
      // 强制重绘刻度与标尺时间（makeLabel 生效）
      viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
      viewer.timeline.updateFromClock();
    }
    // Animation 控件：Cesium Viewer 无公开 animationViewModel，需经 viewer._animation.viewModel 访问
    const avm = viewer._animation && viewer._animation.viewModel;
    if (avm) {
      avm.timeFormatter = (jd) => {
        const d = Cesium.JulianDate.toDate(jd);
        return local ? fmtTime(d) : fmtTimeUTC(d);
      };
      avm.dateFormatter = (jd) => {
        const d = Cesium.JulianDate.toDate(jd);
        const M = local ? d.getMonth() : d.getUTCMonth();
        const D = local ? d.getDate() : d.getUTCDate();
        const Y = local ? d.getFullYear() : d.getUTCFullYear();
        return `${Y}-${p(M + 1)}-${p(D)}`;
      };
    }
  }, [viewerRef, state, timeDisplay]);

  // 让 Cesium timeline 时间轴「左右无限」：显示时刻接近 start/stop 边界时自动扩展范围，
  // timeline 始终有可点击/拖动的区域（默认固定范围做不到）。
  // 注意：仅改 clock.startTime/stopTime 不会刷新 Timeline 控件（它缓存自己的范围），
  // 必须再调 timeline.zoomTo() 让可视范围/滚动位置跟随，否则播放超出后时间轴不滚动。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    const EXPAND_S = 12 * 3600; // 每次向该侧扩展 12h
    const MARGIN_MS = 6 * 3600e3;  // 距边界 6h 内触发扩展
    const listener = (clock) => {
      let changed = false;
      const t = Cesium.JulianDate.toDate(clock.currentTime).getTime();
      const start = Cesium.JulianDate.toDate(clock.startTime).getTime();
      const stop = Cesium.JulianDate.toDate(clock.stopTime).getTime();
      if (t - start < MARGIN_MS) {
        clock.startTime = Cesium.JulianDate.addSeconds(clock.startTime, -EXPAND_S, new Cesium.JulianDate());
        changed = true;
      }
      if (stop - t < MARGIN_MS) {
        clock.stopTime = Cesium.JulianDate.addSeconds(clock.stopTime, EXPAND_S, new Cesium.JulianDate());
        changed = true;
      }
      if (changed && viewer.timeline) {
        // 让时间线可视范围跟随新范围（否则时间轴停留原位，播放超出后不滚动）
        viewer.timeline.zoomTo(clock.startTime, clock.stopTime);
      }
    };
    viewer.clock.onTick.addEventListener(listener);
    return () => {
      const v = viewerRef.current;
      if (v && v.clock) v.clock.onTick.removeEventListener(listener);
    };
  }, [viewerRef, state]);

  // 每帧：相机跟踪选中星（仅地固系；惯性由 postUpdate 的 ICRF 变换接管，避免 lookAt 冲突）+ 同步 onTimeChange。
  // 首次进入跟踪前记录相机状态，跟踪失效/关闭时用 setView 完全还原（位置+朝向），
  // 否则 lookAt 残留的 ENU 变换与朝向会导致视角无法回到跟踪前。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    const listener = (clock) => {
      const d = Cesium.JulianDate.toDate(clock.currentTime);
      const restoreCamera = () => {
        const st = trackRestoreRef.current;
        trackRestoreRef.current = null;
        if (!st) return;
        const camera = viewer.scene.camera;
        camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        camera.setView({
          destination: st.destination,
          orientation: { direction: st.direction, up: st.up },
        });
      };
      if (trackSatRef.current && !inertialRef.current) {
        const hl = highlightNoradRef.current;
        const pt = hl != null ? noradToPointRef.current[hl] : null;
        if (pt) {
          if (!trackRestoreRef.current) {
            trackRestoreRef.current = {
              destination: Cesium.Cartesian3.clone(viewer.camera.position),
              direction: Cesium.Cartesian3.clone(viewer.camera.direction),
              up: Cesium.Cartesian3.clone(viewer.camera.up),
            };
          }
          viewer.camera.lookAt(pt.position, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-70), 2500000));
        } else {
          restoreCamera();
        }
      } else {
        restoreCamera();
      }
      const cb = onTimeChangeRef.current;
      if (cb) cb(d);
    };
    viewer.clock.onTick.addEventListener(listener);
    // 卸载时 viewer 可能已 destroy（其 clock 属性被置空），需经 viewerRef 判空再移除
    return () => {
      const v = viewerRef.current;
      if (v && v.clock) v.clock.onTick.removeEventListener(listener);
    };
  }, [viewerRef, state, inertialRef, noradToPointRef]);
}
