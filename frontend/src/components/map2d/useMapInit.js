// 2D 地图骨架 hook：OpenLayers Map 实例、图层/source 集合、底图/投影切换、
// 点击拾取、尺寸自适应（容器恢复 / 窗口 resize）。
import { useEffect, useRef } from "react";
import { Map, View } from "ol";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { fromLonLat } from "ol/proj";
import Zoom from "ol/control/Zoom";
import { Fill, Stroke, Style } from "ol/style";
import { createTileSource } from "../mapStyles.js";
import { trackStyle } from "../trackgeo.js";
import { useResizeRedraw } from "../../hooks/useResizeRedraw.js";

export function useMapInit({ mapRef, mapObjRef, gtRef, projRef, mapStyle, proj, active, sidebarVisible, onHover }) {
  const trackSourceRef = useRef(null);          // 完整轨迹图层
  const visibleSourceRef = useRef(null);        // 可见段高亮图层
  const stationSourceRef = useRef(null);        // 地面站图层
  const posSourceRef = useRef(null);            // 实时/时间轴位置图层
  const gridSourceRef = useRef(null);           // 经纬网/经纬度标注图层
  const footprintSourceRef = useRef(null);      // 卫星可视范围（覆盖圆）图层
  const stationFootprintSourceRef = useRef(null); // 地面站可视范围图层
  const terminatorSourceRef = useRef(null);     // 晨昏线（日/夜分界）图层 source

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
      if (best && bestD < maxD) onHover(best);
    });

    return () => map.setTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [mapStyle, mapObjRef]);

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
  }, [proj, mapObjRef]);

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
  }, [active, sidebarVisible, mapObjRef]);

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
  }, [mapObjRef]);

  return {
    trackSourceRef, visibleSourceRef, stationSourceRef, posSourceRef,
    gridSourceRef, footprintSourceRef, stationFootprintSourceRef, terminatorSourceRef,
  };
}
