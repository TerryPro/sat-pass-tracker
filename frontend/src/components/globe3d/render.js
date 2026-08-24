// globe3d 子模块：Cesium 实体渲染函数（纯逻辑，负责在 viewer 上增删实体）。
// 每个函数接收 viewer、数据与对应实体引用（ref），函数内部自行清理旧实体并重建；
// 组件只需在 useEffect 中按数据变化调用即可。
// Cesium 通过 cesiumGlobal 惰性代理访问（运行时已加载），避免静态打包。
import { Cesium } from "./cesiumGlobal.js";
import { EARTH_RADIUS_KM, SAT_DEFAULT_ALT, llh, inertialDisplay } from "./coords.js";

// 渲染地表轨迹 + 真实空间轨道线（按圈分组，每圈一条空间轨道线，随数据/显示时长重建）
export function renderTrack({ viewer, gt, visibleHours, eci, entitiesRef }) {
  if (!viewer || !gt || !gt.points || !gt.points.length) return;
  const startT = new Date(gt.points[0].t).getTime();
  const cutoff = startT + visibleHours * 3600 * 1000;
  const pts = gt.points.filter((p) => new Date(p.t).getTime() <= cutoff);
  if (!pts.length) return;

  // 清掉上一批轨迹实体
  entitiesRef.current.forEach((e) => viewer.entities.remove(e));
  entitiesRef.current = [];

  // 按圈号分组（每圈一条空间轨道线）
  const groups = [];
  let cur = [];
  pts.forEach((p) => {
    if (cur.length && p.orbit !== cur[cur.length - 1].orbit) {
      groups.push(cur);
      cur = [];
    }
    cur.push(p);
  });
  if (cur.length) groups.push(cur);

  groups.forEach((g, gi) => {
    const hue = 205 + (gi % 12) * 6;
    const color = Cesium.Color.fromHsl(hue / 360, 0.85, 0.62, 0.8);

    // 真实空间轨道线（按卫星高度定位，不画地表投影，避免地面出现轨道线）
    if (g.length >= 2) {
      const orbit = viewer.entities.add({
        polyline: {
          // 惯性视角：每点按其采样时刻转 ICRF，显示时随时钟时刻旋转，与惯性相机一致
          positions: eci
            ? new Cesium.CallbackProperty(
                () => g.map((p) => inertialDisplay(viewer, p.t, p.lon, p.lat, p.alt_km)),
                false
              )
            : g.map((p) => llh(p.lon, p.lat, p.alt_km)),
          width: 1,
          material: color,
        },
      });
      entitiesRef.current.push(orbit);
    }
  });
}

// 渲染可见段 AOS~LOS 高亮 + 端点标注（支持 selected / all 两种模式）
export function renderPasses({ viewer, gt, passes, activePass, passMode, visibleHours, eci, entitiesRef }) {
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

  const mkMarker = (p, label, color) => {
    // 惯性视角：按采样时刻转 ICRF，显示随时钟时刻旋转（与轨道一致）
    const pos = eci
      ? new Cesium.CallbackProperty(
          () => inertialDisplay(viewer, p.t, p.lon, p.lat, p.alt_km),
          false
        )
      : llh(p.lon, p.lat, p.alt_km);
    const e = viewer.entities.add({
      position: pos,
      point: { pixelSize: 8, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5 },
      label: {
        text: label,
        font: "bold 12px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, -18),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
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

    // 可见段弧线（黄色，画在卫星轨道高度上）
    const seg = viewer.entities.add({
      polyline: {
        positions: eci
          ? new Cesium.CallbackProperty(
              () => vis.map((p) => inertialDisplay(viewer, p.t, p.lon, p.lat, p.alt_km)),
              false
            )
          : vis.map((p) => llh(p.lon, p.lat, p.alt_km)),
        width: 2,
        material: Cesium.Color.YELLOW,
      },
    });
    entitiesRef.current.push(seg);

    mkMarker(vis[0], "AOS", Cesium.Color.RED);
    mkMarker(vis[vis.length - 1], "LOS", Cesium.Color.LIME);
  });
}

// 渲染地面站标记（标杆/底座圆环/顶部红点）+ 0° 仰角通视圆（切圆，随卫星高度/开关重建）
export function renderStation({
  viewer,
  gt,
  lat,
  lon,
  showVisibility,
  satellite,
  activePass,
  currentPos,
  stationRef,
  footprintRef,
}) {
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

  // 通视圆：优先用选中过境最大仰角点的卫星高度，其次实时，最后按卫星类型默认
  let altKm = SAT_DEFAULT_ALT[satellite] || 400;
  if (activePass) {
    const mx = activePass.max_elevation_at;
    if (mx) {
      const match = gt && gt.points.find((p) => new Date(p.t).getTime() === new Date(mx).getTime());
      if (match && match.alt_km > 0) altKm = match.alt_km;
    }
  } else if (currentPos && currentPos.alt_km) {
    altKm = currentPos.alt_km;
  }

  if (footprintRef.current) {
    viewer.entities.remove(footprintRef.current);
    footprintRef.current = null;
  }
  if (showVisibility) {
    // 可视范围 = 地面站处的切平面与卫星轨道球面的交线（切圆）
    // 切平面过地面站、垂直于"地面站-地心"连线：
    //   切圆中心 = 地面站位置
    //   切圆半径 = √(h(2R+h))
    const R = EARTH_RADIUS_KM * 1000;            // 地球半径（米）
    const h = altKm * 1000;                      // 卫星高度（米）
    const circleR = Math.sqrt(h * (2 * R + h));  // 切圆半径（米）

    // 切圆中心 = 地面站位置（在切平面上）
    const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const up = Cesium.Cartesian3.normalize(center, new Cesium.Cartesian3());

    // 在切平面上构造两个正交基向量（东向 + 北向）
    const ref = Math.abs(up.z) < 0.99 ? new Cesium.Cartesian3(0, 0, 1) : new Cesium.Cartesian3(1, 0, 0);
    const east = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(ref, up, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const north = Cesium.Cartesian3.cross(up, east, new Cesium.Cartesian3());

    // 在切平面上生成 64 个采样点构成多边形
    const positions = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      positions.push(
        Cesium.Cartesian3.add(
          center,
          Cesium.Cartesian3.add(
            Cesium.Cartesian3.multiplyByScalar(east, circleR * Math.cos(a), new Cesium.Cartesian3()),
            Cesium.Cartesian3.multiplyByScalar(north, circleR * Math.sin(a), new Cesium.Cartesian3()),
            new Cesium.Cartesian3()
          ),
          new Cesium.Cartesian3()
        )
      );
    }

    footprintRef.current = viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.SKYBLUE.withAlpha(0.18),
        outline: true,
        outlineColor: Cesium.Color.SKYBLUE.withAlpha(0.85),
      },
    });
  }
}

// 渲染卫星位置点（统一单标记）：实时模式用 currentPos，播放模式用时间轴点；统一橙色
export function renderRealPoint({ viewer, gt, liveMode, currentPos, idx, eci, pointRef }) {
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
    : llh(p.lon, p.lat, p.alt_km || 0);
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
