// 多星座 3D 渲染组件（Cesium）：大量卫星以其真实三维轨道位置悬浮显示 + 选中星轨道线。
// 卫星位置由父级用 SGP4 算出 ECI(惯性 J2000) 坐标；本组件按「坐标系模式」决定如何摆放：
//   - fixed（地固系）：用「显示时刻」的 ICRF→ECEF 矩阵把 ECI 转到地固系，地球固定、卫星相对地表移动；
//   - inertial（惯性系，仅 3D 有效）：卫星点同样转成 ECEF 世界坐标（Cesium 世界系是地固系），但相机每帧
//     变换到 ICRF 参考系，抵消地球自转——屏幕效果为轨道/卫星相对星空固定、地球自转。
// 大量卫星用 PointPrimitiveCollection（高性能，可千点）。
import React, { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { Cesium, loadCesium } from "./cesiumGlobal.js";
import { createViewer, resetCamera, setBasemap, setSceneMode, setSkyOption } from "./viewer.js";
import { interpEciAtMs } from "../../sat/satmath.mjs";

// ECI(km) → ECEF 地心坐标（米），基于指定显示时刻的 ICRF→Fixed 矩阵（纯函数，不依赖 viewer）
function eciToEcef(eci, date) {
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
function orbitLinePositions(o, viewer, inertial) {
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
function normalColor() { return (_normal ||= Cesium.Color.fromCssColorString("rgba(63,200,255,0.9)")); }
function selectedColor() { return (_selected ||= Cesium.Color.ORANGE); }

// 向集合添加一个卫星点，返回该 primitive（供重建/兜底新增共用）
function addPoint(coll, p, date, sel) {
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

const MultiGlobe = React.forwardRef(function MultiGlobe(
  {
    positions = [],       // [{ norad, name, eci:{x,y,z}, isValid }]
    orbits = [],          // [{ norad, name, path:[{eci:{x,y,z}, t}] }]
    displayDate = null,   // 显示时刻(Date)：由 Cesium 时钟驱动，父级每帧同步
    highlightNorad = null,
    onPickNorad = null,
    active = true,
    // 场景与底图设置：视图模式 / 底图 / 星空开关（受父级控制）
    viewMode = "3d",      // 3d|2d|columbus
    basemap = "satellite",// satellite|street|terrain|dark|nature|blackmarble|none
    skyOn = true,
    hdr = true,           // 高动态范围（scene.highDynamicRange，satvis 的 HDR）
    atmosphere = true,    // 大气散射（scene.skyAtmosphere，satvis 的 Atmosphere）
    lighting = true,      // 太阳光照与阴影（scene.globe.enableLighting）
    frame = "fixed",      // 坐标系：fixed（地固）| inertial（惯性，仅 3D 生效）
    onTimeChange = null,  // 时钟每帧同步：onTimeChange(Date)
    timeDisplay = "utc",  // Cesium 时间控件显示时区：utc | local
    getPositionsAt = null, // (Date) => [{ norad, eci, isValid }]：按时刻插值全组位置（每帧同步卫星点）
    trackSat = false,     // 相机跟踪选中卫星（仅地固系生效；惯性由 ICRF 相机变换接管）
    orbitColor = "rgba(255,180,70,0.55)", // 普通轨道线颜色（设置页可配置）
    showNames = false,    // 是否在 3D 卫星点上显示卫星名字标签
  },
  ref
) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const createdRef = useRef(false);
  const resizeObserverRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const [state, setState] = useState("loading"); // loading|ready|error

  const pointsRef = useRef([]);
  const orbitEntitiesRef = useRef([]);
  const noradToPointRef = useRef({});
  const pointsCollectionRef = useRef(null);
  // 卫星名字标签：与点集合同生命周期，showNames 控制显示/隐藏
  const labelsCollectionRef = useRef(null);
  const noradToLabelRef = useRef({});
  const showNamesRef = useRef(showNames);
  showNamesRef.current = showNames;
  // 读取最新显示时刻，供轨道线 CallbackProperty 每帧取用（避免因 displayDate 重建实体）
  const displayDateRef = useRef(displayDate);
  displayDateRef.current = displayDate;
  // 惯性模式是否生效（惯性 && 3D），供轨道线每帧区分转换方式
  const inertialRef = useRef(false);
  inertialRef.current = frame === "inertial" && viewMode === "3d";
  // 记录上次卫星点数，判定是否需要重建点集合（换组才重建，播放只原地更新）
  const lastCountRef = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then(() => !cancelled && setState("ready"))
      .catch((e) => !cancelled && setState(String((e && e.message) || e)));
    return () => { cancelled = true; };
  }, []);

  // 懒创建 Viewer
  useEffect(() => {
    if (!active || state !== "ready" || createdRef.current || !containerRef.current) return;
    const viewer = createViewer(containerRef.current, { showClockControls: true });
    viewerRef.current = viewer;
    createdRef.current = true;
    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;
    resetCamera(viewer, 0, 20000000);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      if (picked && picked.primitive && picked.primitive.id !== undefined) {
        onPickNorad && onPickNorad(picked.primitive.id);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    clickHandlerRef.current = handler;

    return () => {
      if (clickHandlerRef.current) { clickHandlerRef.current.destroy(); clickHandlerRef.current = null; }
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      viewer.destroy();
      viewerRef.current = null;
      createdRef.current = false;
      pointsRef.current = [];
      orbitEntitiesRef.current = [];
      noradToPointRef.current = {};
      lastCountRef.current = -1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state]);

  // 应用场景与底图设置（3D/2D/哥伦布、底图、星空）到已创建的 viewer
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    setSceneMode(viewer, viewMode);
    setSkyOption(viewer, skyOn);
    setBasemap(viewer, basemap);
    viewer.scene.highDynamicRange = hdr;
    viewer.scene.skyAtmosphere.show = atmosphere;
    viewer.scene.globe.enableLighting = lighting;
  }, [viewMode, basemap, skyOn, hdr, atmosphere, lighting, state]);

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
  }, [timeDisplay, state]);

  // Cesium 自带控件（animation/timeline）驱动时钟：每帧把当前时刻同步给父级
  // （供卫星点插值取位、选中星信息等）。光照/晨昏线/惯性地球自转都直接用 clock。
  const onTimeChangeRef = useRef(onTimeChange);
  onTimeChangeRef.current = onTimeChange;
  const getPositionsAtRef = useRef(getPositionsAt);
  getPositionsAtRef.current = getPositionsAt;
  const trackSatRef = useRef(trackSat);
  trackSatRef.current = trackSat;
  const highlightNoradRef = useRef(highlightNorad);
  highlightNoradRef.current = highlightNorad;
  // 跟踪开启前的相机状态（用于关闭/失效时完全还原视角：位置 + 朝向）
  const trackRestoreRef = useRef(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    const listener = (clock) => {
      const d = Cesium.JulianDate.toDate(clock.currentTime);
      // 每帧用最新时钟时刻同步卫星点位置（与轨道线同帧同时刻），
      // 避免高倍速下 React 状态滞后造成「卫星脱轨」
      const gp = getPositionsAtRef.current;
      if (gp && pointsCollectionRef.current) {
        for (const p of gp(d)) {
          const pt = noradToPointRef.current[p.norad];
          if (pt && p.isValid && isFinite(p.eci.x)) pt.position = eciToEcef(p.eci, d);
          const lab = noradToLabelRef.current[p.norad];
          if (lab && p.isValid && isFinite(p.eci.x)) lab.position = eciToEcef(p.eci, d);
        }
      }
      // 相机跟踪选中星（仅地固系；惯性由 postUpdate 的 ICRF 变换接管，避免 lookAt 冲突）。
      // 首次进入跟踪前记录相机状态，跟踪失效/关闭时用 setView 完全还原（位置+朝向），
      // 否则 lookAt 残留的 ENU 变换与朝向会导致视角无法回到跟踪前。
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
  }, [state]);

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
  }, [state]);

  // 暴露给父级：setTime 设置时钟（供「回到当前」等使用）
  React.useImperativeHandle(ref, () => ({
    setTime: (d) => {
      const v = viewerRef.current;
      if (v) v.clock.currentTime = Cesium.JulianDate.fromDate(d);
    },
  }), []);

  // 卫星点渲染：容量未变时原地更新（位置/高亮），仅换组或点数变化才重建集合
  // 播放每帧 displayDate 变化时只改 position，避免整集合 remove+add 的 GPU 分配开销
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
  }, [positions, displayDate, highlightNorad, state]);

  // 「卫星名字」开关：仅切换标签集合可见性（集合随点集合同生命周期，避免反复创建/销毁）
  useEffect(() => {
    const lc = labelsCollectionRef.current;
    if (lc) lc.show = showNames;
  }, [showNames, state]);

  // 轨道线 entities：只在「结构」变化（颗数/隐藏/总开关/坐标系）时重建；
  // 轨道数据（父级 60s 重采样体现 J2 进动）经 orbitsMapRef 每帧读取，避免重建实体闪烁
  const orbitsMapRef = useRef(new Map());
  orbitsMapRef.current = new Map(orbits.map((o) => [o.norad, o]));
  // 结构 key：仅 norad 列表（重采样不改变结构 → 不重建；数据变化由回调读 ref 生效）
  const orbitKey = useMemo(() => orbits.map((o) => o.norad).join("|"), [orbits]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    orbitEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    orbitEntitiesRef.current = [];
    if (!orbitsMapRef.current.size) return;
    orbitsMapRef.current.forEach((o) => {
      if (!o.cache || o.cache.samples.length < 2) return;
      const e = viewer.entities.add({
        polyline: {
          // 统一算法（见 orbitLinePositions）：仅坐标系决定转换时刻
          positions: new Cesium.CallbackProperty(
            () => orbitLinePositions(o, viewer, inertialRef.current),
            false
          ),
          width: 1,
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(orbitColor)) },
      });
      orbitEntitiesRef.current.push(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbitKey, orbitColor, state, frame]);

  // 选中星轨道高亮：叠加同宽、高亮颜色的轨道线作标识（不加粗），
  // 取消选中或结构变化时移除；避免因高亮重建全部轨道线实体
  const highlightOrbitRef = useRef(null);
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
    highlightOrbitRef.current = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => orbitLinePositions(cur, viewer, inertialRef.current),
          false
        ),
        width: 1, // 与普通轨道线同宽，仅用颜色区分（不加粗）
        material: new Cesium.ColorMaterialProperty(
          Cesium.Color.fromCssColorString("rgba(255,90,90,0.95)")),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightNorad, orbitKey, state]);

  // 惯性坐标系：每帧把相机变换到 ICRF 参考系，使地球自转、轨道/卫星相对星空固定。
  // 仅 frame=inertial 且 3D 视图时生效；切换离开时还原相机到地固参考系。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    const inertial = frame === "inertial" && viewMode === "3d";
    if (!inertial) {
      // 还原相机到地固参考系（避免残留惯性变换）
      const camera = viewer.scene.camera;
      if (camera.transform && !Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY)) {
        camera.lookAtTransform(Cesium.Matrix4.IDENTITY, Cesium.Cartesian3.clone(camera.position));
      }
      return;
    }
    const listener = (scene, time) => {
      const m = Cesium.Transforms.computeIcrfToFixedMatrix(time);
      if (!m) return;
      const camera = scene.camera;
      const offset = Cesium.Cartesian3.clone(camera.position);
      camera.lookAtTransform(
        Cesium.Matrix4.fromRotationTranslation(m, Cesium.Cartesian3.ZERO),
        offset
      );
    };
    viewer.scene.postUpdate.addEventListener(listener);
    return () => {
      // 卸载时 viewer 可能已 destroy（scene 被置空），判空后再还原相机
      const v = viewerRef.current;
      if (v && v.scene && v.scene.postUpdate) {
        v.scene.postUpdate.removeEventListener(listener);
        const camera = v.scene.camera;
        if (camera) {
          camera.lookAtTransform(Cesium.Matrix4.IDENTITY, Cesium.Cartesian3.clone(camera.position));
        }
      }
    };
  }, [frame, viewMode, state]);

  // 隐藏切回时刷新尺寸
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !active) return;
    const timers = [0, 60, 120, 300].map((ms) => setTimeout(() => viewer.resize(), ms));
    return () => timers.forEach(clearTimeout);
  }, [active]);

  if (state !== "ready" && state !== "loading") {
    return <Box sx={{ p: 2, color: "#f87171", fontSize: 13 }}>{state}</Box>;
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
      <Box
        ref={containerRef}
        sx={{ flex: 1, minHeight: 0, width: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid", borderColor: "divider", bgcolor: "#000" }}
      />
      {state === "loading" && (
        <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 13 }}>
          加载 3D 视图…
        </Box>
      )}
    </Box>
  );
});

export default MultiGlobe;
