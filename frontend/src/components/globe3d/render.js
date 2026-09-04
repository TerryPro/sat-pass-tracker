// globe3d 子模块：Cesium 实体渲染函数（纯逻辑，负责在 viewer 上增删实体）。
// 每个函数接收 viewer、数据与对应实体引用（ref），函数内部自行清理旧实体并重建；
// 组件只需在 useEffect 中按数据变化调用即可。
// Cesium 通过 cesiumGlobal 惰性代理访问（运行时已加载），避免静态打包。
import { Cesium } from "./cesiumGlobal.js";
import { EARTH_RADIUS_KM, SAT_DEFAULT_ALT, llh, inertialDisplay } from "./coords.js";
import { computeFootprint } from "../footprint.js";

// 渲染地表轨迹 + 真实空间轨道线（按圈分组，每圈一条空间轨道线，随数据/显示时长重建）
// groupByOrbit=false 时（Cesium 2D）整段连成一条：跨 ±180° 的连续线交给 Cesium 的
// wrapLongitude 自动做世界副本，避免后端按「±180° 经度跳变」误增 orbit 号导致的断点。
// surface=true 时（2D 星下点页）轨迹画在地表（alt=0），否则画在卫星轨道高度 alt_km（3D 空间轨道）。
//   高轨卫星（GEO/IGSO alt≈35786km）若仍画在 alt_km，2D 投影会把高空点投到异常位置导致轨迹消失。
// color 可选：给定 CSS 颜色时统一使用该颜色（2D 随暗/亮主题传色）；缺省按圈取色（3D）。
export function renderTrack({ viewer, gt, visibleHours, eci, entitiesRef, groupByOrbit = true, surface = false, color = null }) {
  if (!viewer || !gt || !gt.points || !gt.points.length) return;
  const startT = new Date(gt.points[0].t).getTime();
  const cutoff = startT + visibleHours * 3600 * 1000;
  const pts = gt.points.filter((p) => new Date(p.t).getTime() <= cutoff);
  if (!pts.length) return;

  // 清掉上一批轨迹实体
  entitiesRef.current.forEach((e) => viewer.entities.remove(e));
  entitiesRef.current = [];

  // 分组：默认按 orbit 号分圈（3D 每圈一条）；groupByOrbit=false 时整段一条
  const groups = [];
  if (groupByOrbit) {
    let cur = [];
    pts.forEach((p) => {
      if (cur.length && p.orbit !== cur[cur.length - 1].orbit) {
        groups.push(cur);
        cur = [];
      }
      cur.push(p);
    });
    if (cur.length) groups.push(cur);
  } else {
    groups.push(pts);
  }

  groups.forEach((g, gi) => {
    // 2D 传 color 时统一单色（随主题）；3D 按圈取色
    const matColor = color
      ? Cesium.Color.fromCssColorString(color)
      : Cesium.Color.fromHsl((205 + (gi % 12) * 6) / 360, 0.85, 0.62, 0.8);

    // 真实空间轨道线（按卫星高度定位，不画地表投影，避免地面出现轨道线）
    if (g.length < 2) return;
    const orbit = viewer.entities.add({
      polyline: {
        // 惯性视角：每点按其采样时刻转 ICRF，显示时随时钟时刻旋转，与惯性相机一致
        positions: eci
          ? new Cesium.CallbackProperty(
              () => g.map((p) => inertialDisplay(viewer, p.t, p.lon, p.lat, p.alt_km)),
              false
            )
          : g.map((p) => llh(p.lon, p.lat, surface ? 0 : p.alt_km)),
        width: 1,
        material: matColor,
      },
    });
    entitiesRef.current.push(orbit);
  });
}

// 渲染可见段 AOS~LOS 高亮 + 端点标注（支持 selected / all 两种模式）
// surface=true 时（2D 星下点页）画在地表（alt=0），否则画在轨道高度之上（3D）
// theme：'dark'（亮黄可见段 + 白字黑晕，缺省/3D）| 'light'（深琥珀可见段 + 深字浅晕，2D 亮主题）
export function renderPasses({ viewer, gt, passes, activePass, passMode, visibleHours, eci, entitiesRef, surface = false, theme = "dark" }) {
  if (!viewer || !gt || !gt.points || !passes) return;
  entitiesRef.current.forEach((e) => viewer.entities.remove(e));
  entitiesRef.current = [];

  const startT = new Date(gt.points[0].t).getTime();
  const cutoff = startT + visibleHours * 3600 * 1000;

  let passesToDraw;
  if (passMode === "selected") {
    passesToDraw = activePass ? [activePass] : [];
  } else {
    passesToDraw = passes.filter((pass) => {
      const tAos = new Date(pass.aos).getTime();
      const tLos = new Date(pass.los).getTime();
      return tLos >= startT && tAos <= cutoff;
    });
  }
  if (!passesToDraw.length) return;

  // 配色随主题（与 OL 2D 可见段一致）：暗色底图亮黄/白字黑晕；亮色底图深琥珀/深字浅晕
  const passColor = theme === "light" ? "#b45309" : "#ffc400";
  const labelFill = theme === "light" ? "#111827" : "#ffffff";
  const labelHalo = theme === "light" ? "#ffffff" : "#000000";

  const mkMarker = (p, label, color) => {
    // 惯性视角：按采样时刻转 ICRF，显示随时钟时刻旋转（与轨道一致）
    const pos = eci
      ? new Cesium.CallbackProperty(
          () => inertialDisplay(viewer, p.t, p.lon, p.lat, p.alt_km),
          false
        )
      : llh(p.lon, p.lat, surface ? 1 : p.alt_km);
    const e = viewer.entities.add({
      position: pos,
      point: { pixelSize: 8, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5 },
      label: {
        text: label,
        font: "bold 12px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, -18),
        fillColor: Cesium.Color.fromCssColorString(labelFill),
        outlineColor: Cesium.Color.fromCssColorString(labelHalo),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      },
    });
    entitiesRef.current.push(e);
  };

  passesToDraw.forEach((pass) => {
    const t0 = new Date(pass.aos).getTime();
    const t1 = new Date(pass.los).getTime();
    const vis = gt.points.filter((p) => {
      const t = new Date(p.t).getTime();
      return t >= t0 && t <= t1;
    });
    if (vis.length < 2) return;

    // 可见段弧线（随主题取色，不透明宽线保证醒目）。
    // surface（2D 地表）与 3D 轨道高度分支都直接用纯色宽 polyline；
    // 与同层轨道线的覆盖顺序由调用方（CesiumMap2D 重挂顶层 / effect 注册顺序）保证。
    const seg = viewer.entities.add({
      polyline: {
        positions: eci
          ? new Cesium.CallbackProperty(
              () => vis.map((p) => inertialDisplay(viewer, p.t, p.lon, p.lat, p.alt_km)),
              false
            )
          : vis.map((p) => llh(p.lon, p.lat, surface ? 1 : p.alt_km + 50)),
        width: surface ? 2 : 3,
        // 0.999 而非 1.0：alpha=1 会让 Cesium 归入 opaque 通道（先绘制），
        // 反被后绘制的半透明轨道线（translucent）覆盖；0.999 归入 translucent 通道，
        // 与轨道线同通道竞争，配合「后添加者在上」即可始终显示在轨道线上方。
        material: Cesium.Color.fromCssColorString(passColor).withAlpha(0.999),
      },
    });
    entitiesRef.current.push(seg);

    mkMarker(vis[0], "AOS", Cesium.Color.RED);
    mkMarker(vis[vis.length - 1], "LOS", Cesium.Color.LIME);
  });
}

// 渲染地面站静态标记（标杆/底座圆环/顶部红点）。
// 仅依赖站点坐标：调用方应在 lat/lon 变化时才重建，避免随实时位置（currentPos）高频 remove+add 闪烁。
export function renderStationMarker({ viewer, lat, lon, stationRef }) {
  if (!viewer) return;
  // 重建：清掉旧的地面站实体
  if (stationRef.current) {
    const { pole, ring, dot } = stationRef.current;
    viewer.entities.remove(pole);
    viewer.entities.remove(ring);
    viewer.entities.remove(dot);
    stationRef.current = null;
  }

  // 地面站是贴地实体：直接使用 ECEF 固定坐标（场景中相对地球静止，
  // 惯性相机下表现为跟随地球自转，与轨道分离）
  const stationPos = llh(lon, lat, 0.01);
  const poleTop = llh(lon, lat, 0.05); // 标杆顶端

  // 标杆（垂直天线）
  const pole = viewer.entities.add({
    polyline: {
      positions: [stationPos, poleTop],
      width: 3,
      material: Cesium.Color.RED,
    },
  });
  // 底座圆环（地面站所在位置的小圆环，增加视觉辨识度）
  const ring = viewer.entities.add({
    position: stationPos,
    ellipse: {
      semiMajorAxis: 200,
      semiMinorAxis: 200,
      material: Cesium.Color.RED.withAlpha(0.3),
      outline: true,
      outlineColor: Cesium.Color.RED,
      height: 1,
    },
  });
  // 顶部标记点（红点）
  const dot = viewer.entities.add({
    position: poleTop,
    point: {
      pixelSize: 14,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      // 不设置 disableDepthTestDistance，让地球遮挡背面地面站
    },
    label: {
      text: `地面站\n${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
      font: "bold 12px sans-serif",
      pixelOffset: new Cesium.Cartesian2(0, -22),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      // 不设置 disableDepthTestDistance，让地球遮挡背面地面站
    },
  });
  stationRef.current = { pole, ring, dot };
}

// 渲染地面站 0° 仰角通视圆（地表球冠，中心=地面站，半径随卫星高度源/开关变化重建）。
// 独立于地面站标记，避免实时位置更新时把静态标记一起重建导致闪烁。
// 几何用 footprint.js 的 computeFootprint（与 OL 2D 同一数学）：生成的是地球表面上的
// 球冠边界（经纬度序列），而非切平面空间圆——后者是悬浮多边形，2D 投影下形状不正确。
// maxLatDeg：通视圆边界的纬度窗口上限（±90° 为全球）；2D 引擎按自身投影纬度限制由调用方传入。
export function renderStationFootprint({
  viewer,
  gt,
  lat,
  lon,
  showVisibility,
  satellite,
  activePass,
  currentPos,
  footprintRef,
  maxLatDeg = 90,
}) {
  if (!viewer) return;
  if (footprintRef.current) {
    viewer.entities.remove(footprintRef.current);
    footprintRef.current = null;
  }
  if (!showVisibility) return;

  // 通视圆：优先用选中过境最大仰角点的卫星高度，其次实时，最后按卫星类型默认。
  // 注意：max_elevation_at 是解析出的精确峰值时刻，几乎总不在采样网格上，
  // 必须用「最近点」匹配（与 OL 的 resolveSatHeight 一致），否则高轨卫星会回退到
  // 默认 400km（LEO 高度），导致可视范围画得明显偏小、包不住可见弧段。
  let altKm = SAT_DEFAULT_ALT[satellite] || 400;
  if (activePass && activePass.max_elevation_at && gt && gt.points && gt.points.length) {
    const tPeak = new Date(activePass.max_elevation_at).getTime();
    let best = null;
    let bestD = Infinity;
    for (const p of gt.points) {
      const dt = Math.abs(new Date(p.t).getTime() - tPeak);
      if (dt < bestD) { bestD = dt; best = p; }
    }
    if (best && best.alt_km > 0) altKm = best.alt_km;
  } else if (currentPos && currentPos.alt_km) {
    altKm = currentPos.alt_km;
  }

  // 地表球冠边界（OL 同款数学）：footprint.js 已处理触界/含极裁剪与闭合
  const items = computeFootprint(lat, lon, altKm, 0, 3, maxLatDeg);
  if (!items.length || !items[0].ring || items[0].ring.length < 4) return;
  const ring = items[0].ring;
  // ring 首尾已闭合（首点重复）：Cesium PolygonHierarchy 无需重复首点，去掉便于环内填色
  const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  // height:1 极小高度：走普通 Primitive，保证 outline 描边可渲染（贴地 GroundPrimitive 不支持 polygon outline）
  const positions = pts.map(([lo, la]) => Cesium.Cartesian3.fromDegrees(lo, la, 1));

  footprintRef.current = viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      height: 1,
      material: Cesium.Color.fromCssColorString("rgba(56,189,248,0.20)"),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("rgba(56,189,248,0.95)"),
      outlineWidth: 2,
      granularity: 0.01, // 细采样：球冠边界圆滑
    },
  });
}

// 渲染卫星位置点（统一单标记）：实时模式用 currentPos，播放模式用时间轴点；统一橙色
// surface=true 时（2D 星下点页）画在地表（星下点），否则画在卫星轨道高度（3D）
export function renderRealPoint({ viewer, gt, liveMode, currentPos, idx, eci, pointRef, surface = false }) {
  if (!viewer) return;
  // 根据模式选取数据源：实时=Socket 推送位置；播放=时间轴当前索引点
  const p = liveMode ? currentPos : (gt && gt.points[idx]);
  if (!p || typeof p.lat !== "number") return;
  // 惯性视角：按采样时刻换算惯性坐标（贴轨道），显示随时钟时刻旋转
  const t = p.t || new Date().toISOString();
  const pos = eci
    ? new Cesium.CallbackProperty(
        () => inertialDisplay(viewer, t, p.lon, p.lat, p.alt_km || 0),
        false
      )
    : llh(p.lon, p.lat, surface ? 0 : (p.alt_km || 0));
  if (!pointRef.current) {
    pointRef.current = viewer.entities.add({
      position: pos,
      point: {
        pixelSize: 8,
        color: Cesium.Color.ORANGE,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1.5,
        // 不设置 disableDepthTestDistance，让地球遮挡背面的卫星点
      },
    });
  } else {
    pointRef.current.position = pos;
  }
}
