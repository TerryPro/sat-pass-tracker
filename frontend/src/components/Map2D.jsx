// 2D 星下点地图（OpenLayers 子模块）：从 GroundTrack 中拆出。
// 负责世界地图初始化、图层管理与全部 2D 渲染逻辑：
//   - 完整轨迹（按圈拆分、±180° 封口）+ 选中过境可见段高亮（AOS/LOS 标注）
//   - 卫星实时/时间轴位置点 + 覆盖圆，地面站标记 + 可视范围
//   - 经纬网/经纬度标注、晨昏线（夜半球阴影 + 橙黄虚线）
//   - 底图样式切换、投影（EPSG:4326/3857）切换、点击轨迹点查询
// 地图实例与所有图层 source/feature 均维护在本组件内部 ref，不对外暴露。
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { Map, View } from "ol";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat } from "ol/proj";
import Zoom from "ol/control/Zoom";
import { useSelector } from "react-redux";
import { createTileSource, mapIsDark } from "./mapStyles.js";
import { sunPosition, terminatorLat } from "./terminator.js";
import { drawGridOnMap } from "./grid.js";
import { computeFootprint, segmentAndBuildFeatures, trackStyle, satAltKm } from "./trackgeo.js";
import { useAppTheme } from "../hooks/useAppTheme.js";
import { useResizeRedraw } from "../hooks/useResizeRedraw.js";

export default function Map2D({
  params,
  gt,
  passes,
  activeIdx,
  onSelect,
  activePass,
  currentPos,
  idx,
  liveMode,
  proj,
  showGrid,
  showVisibility,
  passMode,
  mapStyle,
  visibleHours,
  showTerminator,
  active, // 2D 容器是否可见（viewMode !== "3d"），用于容器尺寸恢复后刷新
  sidebarVisible,
}) {
  const { lat, lon, alt, satellite } = params;

  const mapRef = useRef(null);          // 地图挂载点
  const mapObjRef = useRef(null);       // OpenLayers Map 实例
  const gtRef = useRef(null);           // 最新星下点数据（供点击回调读取）
  const projRef = useRef("EPSG:4326");  // 当前投影（供点击回调读取）
  const trackSourceRef = useRef(null);  // 完整轨迹图层
  const visibleSourceRef = useRef(null); // 可见段高亮图层
  const stationSourceRef = useRef(null); // 地面站图层
  const posSourceRef = useRef(null);     // 实时/时间轴位置图层
  const gridSourceRef = useRef(null);    // 经纬网/经纬度标注图层
  const realFRef = useRef(null);         // 卫星位置 feature（实时/播放共用）
  const footprintSourceRef = useRef(null); // 卫星可视范围（覆盖圆）图层
  const stationFootprintSourceRef = useRef(null); // 地面站可视范围图层
  const realFootRef = useRef(null);      // 卫星覆盖圆 feature（实时/播放共用）
  const terminatorSourceRef = useRef(null); // 晨昏线（日/夜分界）图层 source
  const lastSatPosRef = useRef(null);    // 最后一次有效卫星位置缓存，用于兜底避免标记短暂消失
  const stationFootFRef = useRef(null);  // 地面站可视范围 feature

  const [hover, setHover] = useState(null); // 当前展示/查询的数据点（仅本组件内部交互使用）
  const [nowMs, setNowMs] = useState(() => Date.now()); // 实时时钟（驱动晨昏线随真实时间移动）

  // 晨昏线橘色虚线开关：来自用户持久化设置（设置页外观卡片中配置）
  const terminatorShowDashed = useSelector(
    (s) => (s.settings?.values?.terminator_show_dashed ?? true) === true
  );
  // 应用主题（设置页 theme 字段）：驱动线条/标签/标记配色与容器底色
  const theme = useAppTheme();

  projRef.current = proj;
  // 同步最新 gt 到 ref：地图点击等空依赖回调需要读取最新数据，避免闭包过期
  useEffect(() => {
    gtRef.current = gt;
  }, [gt]);
  // 数据刷新后清空查询点（对应原 GroundTrack 数据加载成功后的 setHover(null)）
  useEffect(() => {
    setHover(null);
  }, [gt]);

  // 经纬度 → 当前投影下的地图坐标（EPSG:3857 需 Web Mercator 换算，EPSG:4326 直接用度）
  const toMap = (pLon, pLat) =>
    proj === "EPSG:4326" ? [pLon, pLat] : fromLonLat([pLon, pLat]);

  // 初始化地图（一次）；点击轨迹点查询最近数据点
  useEffect(() => {
    if (!mapRef.current) return;
    const trackSource = new VectorSource();
    const visibleSource = new VectorSource();
    const stationSource = new VectorSource();
    const posSource = new VectorSource();
    const gridSource = new VectorSource();
    const footprintSource = new VectorSource();
    const stationFootprintSource = new VectorSource();
    trackSourceRef.current = trackSource;
    visibleSourceRef.current = visibleSource;
    stationSourceRef.current = stationSource;
    posSourceRef.current = posSource;
    gridSourceRef.current = gridSource;
    footprintSourceRef.current = footprintSource;
    stationFootprintSourceRef.current = stationFootprintSource;
    const terminatorSource = new VectorSource();
    terminatorSourceRef.current = terminatorSource;

    // 经纬网图层：默认关闭（由 showGrid 开关控制可见性）
    const gridLayer = new VectorLayer({
      source: gridSource,
      visible: false,
      zIndex: 1, // 放在底图之上、轨迹之下，避免遮挡
    });
    gridLayer.set("name", "grid");

    // 地面站可视范围图层：默认关闭
    const stationFootprintLayer = new VectorLayer({
      source: stationFootprintSource,
      zIndex: 2,
      visible: false,
      style: () =>
        new Style({
          fill: new Fill({ color: "rgba(56, 189, 248, 0.15)" }),
          stroke: new Stroke({ color: "rgba(56, 189, 248, 0.85)", width: 2 }),
        }),
    });
    stationFootprintLayer.set("name", "stationFootprint");

    // 晨昏线图层：置于底图之上、轨迹/位置之下（zIndex 默认 0，低于经纬网 zIndex=1）
    const terminatorLayer = new VectorLayer({ source: terminatorSource, wrapX: true });
    terminatorLayer.set("name", "terminator");

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: createTileSource("satellite"), renderWorldCopies: true }),
        terminatorLayer,
        gridLayer,
        new VectorLayer({ source: trackSource, style: trackStyle, wrapX: true }),
        new VectorLayer({ source: visibleSource, wrapX: true }),
        // 卫星可视范围（覆盖圆）：放在轨迹之上、位置点之下
        new VectorLayer({ source: footprintSource, wrapX: true }),
        stationFootprintLayer,
        new VectorLayer({ source: stationSource }),
        new VectorLayer({ source: posSource }),
      ],
      controls: [new Zoom()],
      view: new View({
        projection: "EPSG:4326",
        center: [110, 30],
        zoom: 1,
        minZoom: 0.3,
        maxZoom: 10,
        multiWorld: true,        // 允许缩到小于一个世界宽度，防止高纬度被裁
        constrainOnlyCenter: true, // 仅约束中心点，不约束分辨率
      }),
    });
    mapObjRef.current = map;

    // 容器渲染完成后用 fit() 自动缩放，保证全球范围（±180° / ±85°）完整显示
    const fitWorld = () => {
      map.updateSize(); // 先同步 DOM 实际尺寸，否则 getSize() 返回旧值
      const size = map.getSize();
      if (!size || size[0] === 0 || size[1] === 0) return;
      const v = map.getView();
      // Web Mercator 的全球可显示范围约 ±85° 纬度
      const ext = fromLonLat([-180, -85]).concat(fromLonLat([180, 85]));
      v.fit(ext, {
        size,
        padding: [10, 10, 10, 10],
        constrainResolution: false,
      });
      // 将 fit 后的实际 zoom 设为 minZoom，防止用户再缩小导致地图不全
      const fittedZoom = v.getZoom();
      v.setMinZoom(fittedZoom);
    };
    map.once("postrender", fitWorld);
    // 组件挂载后延迟再执行（等待 DOM 真实尺寸到位）
    setTimeout(fitWorld, 60);
    setTimeout(fitWorld, 250);
    setTimeout(fitWorld, 500);

    // 点击地图：在轨迹点序列中找与点击位置最近的一点（当前投影坐标平方距离）
    map.on("click", (evt) => {
      const data = gtRef.current;
      if (!data) return;
      const use4326 = projRef.current === "EPSG:4326";
      // 最近点阈值：3857 下约 1e8（≈10km），4326 下约 16（≈4°）
      const maxD = use4326 ? 16 : 1e8;
      let best = null;
      let bestD = Infinity;
      for (const p of data.points) {
        const c = use4326 ? [p.lon, p.lat] : fromLonLat([p.lon, p.lat]);
        const d = (c[0] - evt.coordinate[0]) ** 2 + (c[1] - evt.coordinate[1]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best && bestD < maxD) setHover(best);
    });

    return () => map.setTarget(null);
  }, []);

  // 切换底图样式：仅替换瓦片图层的 source，不影响其他图层
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const layers = map.getLayers().getArray();
    if (layers.length === 0) return;
    const tileLayer = layers[0];
    if (!(tileLayer instanceof TileLayer)) return;
    tileLayer.setSource(createTileSource(mapStyle));
  }, [mapStyle]);

  // 投影切换：重建 View 后用 fit() 自适应容器，保证全球范围完整显示
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const is4326 = proj === "EPSG:4326";
    const latMax = is4326 ? 90 : 85;
    const view = new View({
      projection: proj,
      center: is4326 ? [110, 30] : fromLonLat([110, 30]),
      zoom: is4326 ? 1 : 0.8,
      minZoom: 0.3,
      maxZoom: is4326 ? 10 : 12,
      multiWorld: true,          // 允许缩到小于一个世界宽度
      constrainOnlyCenter: true, // 仅约束中心点，不约束分辨率
    });
    map.setView(view);

    map.updateSize();
    const size = map.getSize();
    if (size && size[0] > 0 && size[1] > 0) {
      const ext = is4326
        ? [-180, -latMax, 180, latMax]
        : fromLonLat([-180, -latMax]).concat(fromLonLat([180, latMax]));
      view.fit(ext, {
        size,
        padding: [10, 10, 10, 10],
        constrainResolution: false,
      });
      // 将 fit 后的实际 zoom 设为 minZoom，防止用户再缩小导致地图不全
      view.setMinZoom(view.getZoom());
    }
    // 切换投影后，如果经纬网开着，按新投影重绘
    if (showGrid) {
      setTimeout(() => drawGrid(proj), 0);
    }
  }, [proj]);

  // 经纬网绘制：见 grid.js（pickStep / drawGridOnMap）
  const drawGrid = (curProj) =>
    drawGridOnMap({ map: mapObjRef.current, source: gridSourceRef.current, proj: curProj });

  // 晨昏线：随实时/推演时间重绘；开关控制显示
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const layer = map.getLayers().getArray().find((l) => l.get("name") === "terminator");
    if (layer) layer.setVisible(showTerminator);
    const src = terminatorSourceRef.current;
    if (!src || !showTerminator) return;
    src.clear();

    // 推演模式取时间轴当前时刻，实时模式取真实当前时刻
    const ms = liveMode
      ? nowMs
      : gt && gt.points && gt.points[idx]
        ? new Date(gt.points[idx].t).getTime()
        : nowMs;
    if (!isFinite(ms)) return;

    const { decl, sunLon } = sunPosition(new Date(ms));
    // 南半球夏季（δ<0）南极进入白昼、北极进入黑夜；夜半球位于晨昏线以北，反之以南
    const d = Math.abs(decl) < 1e-6 ? (decl >= 0 ? 1e-6 : -1e-6) : decl;
    const nightNorth = d < 0;
    const maxLat = proj === "EPSG:4326" ? 90 : 85;
    const clamp = (v) => Math.max(-maxLat, Math.min(maxLat, v));

    const samples = 360;
    const curve = [];
    for (let i = 0; i <= samples; i++) {
      const lon = -180 + (i / samples) * 360;
      curve.push([lon, clamp(terminatorLat(d, sunLon, lon))]);
    }

    // 夜半球阴影：晨昏线 + 顶部/底部边封口成闭合多边形
    const ring = curve.map((p) => [p[0], p[1]]);
    ring.push([180, nightNorth ? maxLat : -maxLat]);
    ring.push([-180, nightNorth ? maxLat : -maxLat]);
    ring.push([curve[0][0], curve[0][1]]);
    const night = new Feature(new Polygon([ring.map(([lon, la]) => toMap(lon, la))]));
    night.setStyle(new Style({ fill: new Fill({ color: "rgba(0,0,30,0.32)" }) }));
    src.addFeature(night);

    // 晨昏线本体：橙黄色虚线（可通过设置页关闭，仅保留夜影）
    if (terminatorShowDashed) {
      const line = new Feature(new LineString(curve.map(([lon, la]) => toMap(lon, la))));
      line.setStyle(
        new Style({ stroke: new Stroke({ color: "rgba(255,190,80,0.9)", width: 1.6, lineDash: [8, 5] }) })
      );
      src.addFeature(line);
    }
  }, [showTerminator, liveMode, idx, gt, proj, nowMs, terminatorShowDashed]);

  // 实时时钟：每 30s 推进一次，驱动晨昏线随真实时间缓慢移动
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // 当 2D 地图容器从 display:none 恢复时刷新尺寸
  useEffect(() => {
    if (!active) return;
    const map = mapObjRef.current;
    if (!map) return;
    // 等待容器尺寸恢复后再更新 OpenLayers 尺寸并重绘
    const timers = [60, 120, 300].map((ms) =>
      setTimeout(() => {
        map.updateSize();
        map.render();
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [active, sidebarVisible]);

  // 主题切换：地图样式函数（轨迹线）按主题取色需主动重渲染；
  // 经纬网同样按主题重绘
  useEffect(() => {
    const map = mapObjRef.current;
    if (map) map.render();
    drawGrid(proj);
  }, [theme, proj]);

  // 开关切换：控制经纬网可见性；打开时首次绘制
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const gridLayer = map.getLayers().getArray().find((l) => l.get("name") === "grid");
    if (!gridLayer) return;
    gridLayer.setVisible(showGrid);
    if (showGrid) drawGrid(proj);
  }, [showGrid, proj, theme]);

  // 缩放/平移变化时，如果经纬网开着，按新 zoom 步长重绘
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const handler = () => {
      if (showGrid) drawGrid(proj);
    };
    const view = map.getView();
    view.on("change:resolution", handler);
    view.on("change:center", handler);
    return () => {
      view.un("change:resolution", handler);
      view.un("change:center", handler);
    };
  }, [proj, showGrid]);

  // 窗口尺寸变化 → 重新 fit 全球（防止容器尺寸改变后地图显示不全）
  useResizeRedraw(() => {
    const map = mapObjRef.current;
    if (!map) return;
    map.updateSize();
    const size = map.getSize();
    const view = map.getView();
    if (!size || !view) return;
    const curProj = view.getProjection().getCode();
    const is4326 = curProj === "EPSG:4326";
    const latMax = is4326 ? 90 : 85;
    const ext = is4326
      ? [-180, -latMax, 180, latMax]
      : fromLonLat([-180, -latMax]).concat(fromLonLat([180, latMax]));
    view.fit(ext, {
      size,
      padding: [10, 10, 10, 10],
      constrainResolution: false,
    });
  }, []);

  // 渲染完整轨迹：按圈拆分，每圈画成一条独立线段并统一单色（不再按圈分色）。
  // 每圈的经度都落在标准 [-180,180] 内，配合 wrapX 既能画全所有圈，又在 ±180° 处
  // 由 wrapX 衔接而不出现颜色跳变的断点。
  useEffect(() => {
    const src = trackSourceRef.current;
    if (!src || !gt) return;
    src.clear();
    // 过滤时间窗口：仅渲染从首点起 N 小时内的轨迹
    const startT = gt.points.length ? new Date(gt.points[0].t).getTime() : 0;
    const cutoff = startT + visibleHours * 3600 * 1000;
    const filtered = gt.points.filter((p) => new Date(p.t).getTime() <= cutoff);
    if (!filtered.length) return;
    const byOrbit = {};
    filtered.forEach((p) => {
      (byOrbit[p.orbit] = byOrbit[p.orbit] || []).push(p);
    });
    Object.entries(byOrbit).forEach(([orbit, pts]) => {
      const fs = segmentAndBuildFeatures(pts, toMap, Number(orbit), proj === "EPSG:4326");
      fs.forEach((f) => src.addFeature(f));
    });
  }, [gt, proj, visibleHours]);

  // 地面站标记（文字/晕圈随主题：暗色白字黑晕、亮色黑字白晕）
  useEffect(() => {
    const src = stationSourceRef.current;
    if (!src) return;
    src.clear();
    const dark = mapIsDark();
    const f = new Feature(new Point(toMap(lon, lat)));
    f.setStyle(
      new Style({
        image: new Circle({
          radius: 7,
          fill: new Fill({ color: "#ef4444" }),
          stroke: new Stroke({ color: dark ? "#fff" : "#7f1d1d", width: 2 }),
        }),
        text: new Text({
          text: "地面站",
          offsetY: 16,
          fill: new Fill({ color: dark ? "#ffffff" : "#111827" }),
          stroke: new Stroke({ color: dark ? "#000000" : "#ffffff", width: 3 }),
        }),
      })
    );
    src.addFeature(f);
  }, [lat, lon, proj, theme]);

  // 地面站可视范围（0° 仰角可通视范围）：以地面站为中心的大圆
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;
    const layer = map.getLayers().getArray().find((l) => l.get("name") === "stationFootprint");
    if (layer) layer.setVisible(showVisibility);
  }, [showVisibility]);

  // 优先用当前选中过境的最大仰角点反算卫星高度，其次用实时位置，最后按卫星类型默认值
  function resolveSatHeight() {
    // 1) 当前选中过境的最大仰角点：过境期间离地面站最近，高度最具代表性
    if (activePass && gt && gt.points && gt.points.length) {
      const tPeak = new Date(activePass.max_elevation_at).getTime();
      let best = null;
      let bestD = Infinity;
      for (const p of gt.points) {
        const dt = Math.abs(new Date(p.t).getTime() - tPeak);
        if (dt < bestD) {
          bestD = dt;
          best = p;
        }
      }
      if (best && typeof best.r_km === "number" && typeof best.el === "number") {
        const h = satAltKm(best.r_km, best.el, alt);
        if (isFinite(h) && h > 0) return h;
      }
    }

    // 2) 实时位置数据
    if (currentPos && typeof currentPos.r_km === "number" && typeof currentPos.el === "number") {
      const h = satAltKm(currentPos.r_km, currentPos.el, alt);
      if (isFinite(h) && h > 0) return h;
    }

    // 3) 按卫星类型默认值（由 TLE 平均运动估算）
    const SAT_HEIGHT_KM = { fo29: 570, iss: 420, css: 400 };
    return SAT_HEIGHT_KM[satellite] || 400;
  }

  // 地面站可视范围圆（含极套环处理，避免 ±180° 接缝竖线）
  useEffect(() => {
    const src = stationFootprintSourceRef.current;
    if (!src) return;
    src.clear();
    stationFootFRef.current = null;
    if (!showVisibility) return;

    const h = resolveSatHeight();
    const maxLatDeg = proj === "EPSG:4326" ? 90 : 85;
    const items = computeFootprint(lat, lon, h, 0, 3, maxLatDeg);
    stationFootFRef.current = [];
    items.forEach(({ ring, collar, boundaryArc }) => {
      const f = new Feature(new Polygon([ring.map(([lo, la]) => toMap(lo, la))]));
      // 含极"全经度套环"不描边，单独用边界弧描边，避免 ±180° 接缝出现竖线
      if (collar) {
        f.setStyle(new Style({ fill: new Fill({ color: "rgba(56, 189, 248, 0.15)" }) }));
      }
      stationFootFRef.current.push(f);
      src.addFeature(f);
      if (collar && boundaryArc) {
        const line = new Feature(new LineString(boundaryArc.map(([lo, la]) => toMap(lo, la))));
        line.setStyle(
          new Style({ stroke: new Stroke({ color: "rgba(56, 189, 248, 0.85)", width: 2 }) })
        );
        stationFootFRef.current.push(line);
        src.addFeature(line);
      }
    });
  }, [showVisibility, lat, lon, alt, currentPos, proj, satellite, activePass, gt]);

  // 过境联动：高亮可见段（AOS~LOS），selected 模式仅当前过境，all 模式显示当前显示窗口内的全部
  useEffect(() => {
    const src = visibleSourceRef.current;
    if (!src || !gt || !passes) return;
    src.clear();

    // 配色随主题：暗色底图亮黄/白字黑晕，亮色底图深琥珀/黑字白晕
    const dark = mapIsDark();
    const passColor = dark ? "#facc15" : "#b45309";
    const haloColor = dark ? "#ffffff" : "#1f2937";
    const labelFill = dark ? "#ffffff" : "#111827";
    const labelHalo = dark ? "#000000" : "#ffffff";

    const startT = gt.points.length ? new Date(gt.points[0].t).getTime() : 0;
    const cutoff = startT + visibleHours * 3600 * 1000;

    let passesToDraw;
    if (passMode === "selected") {
      passesToDraw = activePass ? [activePass] : [];
    } else {
      // 仅保留与当前显示时长窗口有重叠的过境
      passesToDraw = passes.filter((pass) => {
        const tAos = new Date(pass.aos).getTime();
        const tLos = new Date(pass.los).getTime();
        return tLos >= startT && tAos <= cutoff;
      });
    }
    if (passesToDraw.length === 0) return;

    const mkPt = (p, label, color) => {
      const f = new Feature(new Point(toMap(p.lon, p.lat)));
      f.setStyle(
        new Style({
          image: new Circle({
            radius: 3,
            fill: new Fill({ color }),
            stroke: new Stroke({ color: haloColor, width: 1 }),
          }),
          text: new Text({
            text: label,
            offsetY: -12,
            fill: new Fill({ color: labelFill }),
            stroke: new Stroke({ color: labelHalo, width: 3 }),
            font: "bold 11px sans-serif",
          }),
        })
      );
      src.addFeature(f);
    };

    passesToDraw.forEach((pass) => {
      const t0 = new Date(pass.aos).getTime();
      const t1 = new Date(pass.los).getTime();
      const vis = gt.points.filter((p) => {
        const t = new Date(p.t).getTime();
        return t >= t0 && t <= t1;
      });
      if (vis.length < 2) return;

      const fs = segmentAndBuildFeatures(vis, toMap, 0, proj === "EPSG:4326");
      fs.forEach((f) => {
        f.setStyle(new Style({ stroke: new Stroke({ color: passColor, width: 2.5 }) }));
        src.addFeature(f);
      });

      mkPt(vis[0], "AOS", "#ef4444");
      mkPt(vis[vis.length - 1], "LOS", "#22c55e");
    });
  }, [activePass, gt, proj, passMode, passes, visibleHours, theme]);

  // 卫星位置点（统一单标记）：实时模式用 currentPos，播放模式用 gt.points[idx]；统一橙色
  useEffect(() => {
    const src = posSourceRef.current;
    if (!src) return;
    // 根据模式选取数据源：实时=Socket 推送位置；播放=时间轴当前索引点（越界保护）
    let p = liveMode ? currentPos : null;
    if (!liveMode && gt && gt.points && gt.points.length) {
      p = gt.points[Math.min(idx, gt.points.length - 1)];
    }
    let pos = p;
    if (!pos || typeof pos.lat !== "number" || !isFinite(pos.lat)) {
      // 数据暂缺（如切换/重载瞬间 Socket 未回包）时用上一次有效位置兜底，避免标记消失
      pos = lastSatPosRef.current;
    }
    if (!pos || typeof pos.lat !== "number" || !isFinite(pos.lat)) return;
    lastSatPosRef.current = pos;
    const coord = toMap(pos.lon, pos.lat);
    if (!coord || !isFinite(coord[0]) || !isFinite(coord[1])) return;
    if (!realFRef.current) {
      const f = new Feature(new Point(coord));
      f.setStyle(
        new Style({
          image: new Circle({
            radius: 5,
            fill: new Fill({ color: "#f59e0b" }),
            // 描边随主题：暗色底图白边、亮色底图深棕边
            stroke: new Stroke({ color: mapIsDark() ? "#fff" : "#7c4a03", width: 1.5 }),
          }),
        })
      );
      realFRef.current = f;
      src.addFeature(f);
    } else {
      realFRef.current.getGeometry().setCoordinates(coord);
    }
    // 播放模式同步 hover 信息（实时模式 hover 由其他交互更新）
    if (!liveMode) setHover(pos);
  }, [liveMode, currentPos, idx, gt, proj, theme]);

  // 卫星覆盖圆（统一单标记）：实时模式用 currentPos，播放模式用时间轴点；统一橙色
  useEffect(() => {
    const footSrc = footprintSourceRef.current;
    if (!footSrc) return;
    // 根据模式选取数据源，与卫星位置点保持一致（越界保护 + 缓存兜底）
    let p = liveMode ? currentPos : null;
    if (!liveMode && gt && gt.points && gt.points.length) {
      p = gt.points[Math.min(idx, gt.points.length - 1)];
    }
    if (!p || typeof p.lat !== "number" || !isFinite(p.lat)) {
      p = lastSatPosRef.current;
    }
    if (!p || typeof p.r_km !== "number" || typeof p.el !== "number") return;
    try {
      const h = satAltKm(p.r_km, p.el, alt);
      if (!isFinite(h) || h <= 0) return;
      const maxLatDeg = proj === "EPSG:4326" ? 90 : 85;
      const items = computeFootprint(p.lat, p.lon, h, 0, 3, maxLatDeg);
      // 环的结构签名（是否含极套环）：结构变化时需要重建 feature，否则仅更新几何
      const sig = items.map((it) => (it.collar ? 1 : 0)).join(",");
      const fs = realFootRef.current;
      if (!fs || fs.sig !== sig) {
        // 首次或结构变化：重建全部 feature
        footSrc.clear();
        const groups = items.map(({ ring, collar, boundaryArc }) => {
          const group = [];
          const f = new Feature(new Polygon([ring.map(([lo, la]) => toMap(lo, la))]));
          f.setStyle(
            new Style({
              fill: new Fill({ color: "rgba(245,158,11,0.15)" }),
              // 含极"全经度套环"不描边（单独画边界弧），避免 ±180° 出现竖线
              stroke: collar
                ? undefined
                : new Stroke({ color: "rgba(245,158,11,0.8)", width: 1.5 }),
            })
          );
          group.push(f);
          footSrc.addFeature(f);
          if (collar && boundaryArc) {
            const line = new Feature(new LineString(boundaryArc.map(([lo, la]) => toMap(lo, la))));
            line.setStyle(
              new Style({ stroke: new Stroke({ color: "rgba(245,158,11,0.8)", width: 1.5 }) })
            );
            group.push(line);
            footSrc.addFeature(line);
          }
          return group;
        });
        realFootRef.current = { sig, groups };
      } else {
        // 结构一致：仅更新几何，复用 feature 与样式
        items.forEach(({ ring, collar, boundaryArc }, i) => {
          const group = fs.groups[i];
          group[0].setGeometry(new Polygon([ring.map(([lo, la]) => toMap(lo, la))]));
          if (collar && boundaryArc && group[1]) {
            group[1].setGeometry(new LineString(boundaryArc.map(([lo, la]) => toMap(lo, la))));
          }
        });
      }
    } catch (e) {
      // 覆盖圆计算失败不影响位置点显示
    }
  }, [liveMode, currentPos, idx, gt, proj, alt]);

  return (
    <Box
      ref={mapRef}
      sx={{
        flex: 1,
        width: "100%",
        minHeight: 0,
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        // 底图瓦片未覆盖区域（如高纬空白处）：暗色底图深色、亮色底图浅色
        bgcolor: theme === "dark" ? "#10151f" : "#e8eaee",
      }}
    />
  );
}
