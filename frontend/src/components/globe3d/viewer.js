// globe3d 子模块：Cesium Viewer 生命周期与相机管理
// Cesium 通过 cesiumGlobal 惰性代理访问（运行时已加载），避免静态打包。
import { Cesium } from "./cesiumGlobal.js";

// 创建 Viewer（统一隐藏无关控件/关闭默认底图，底图由 loadImagery 手动添加）
// showClockControls：是否显示 Cesium 自带的 animation（播放/暂停/倍速）与 timeline（时间线拖动）控件，
// 默认关闭（卫星轨迹页 3D 原样）；仅卫星星座 3D 页开启
export function createViewer(container, { showClockControls = false } = {}) {
  const now = Cesium.JulianDate.now();
  const start = Cesium.JulianDate.addHours(now, -12, new Cesium.JulianDate());
  const stop = Cesium.JulianDate.addHours(now, 24, new Cesium.JulianDate());
  const viewer = new Cesium.Viewer(container, {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: showClockControls,
    timeline: showClockControls,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    baseLayer: false, // 不创建默认底图，下面手动添加（避免 imageryProvider+baseLayer 冲突导致无贴图）
  });
  viewer.cesiumWidget.creditContainer.style.display = "none"; // 隐藏版权条（仅界面清爽）
  viewer.scene.globe.enableLighting = true; // 开启光照，太阳方位随时间变化时地表明暗随之变化
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 3e8;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 10000;
  // 时钟范围：当前时刻前后（timeline 的可视/可拖动范围），播放到 stopTime 自动停止
  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = now;
  viewer.clock.startTime = start;
  viewer.clock.stopTime = stop;
  viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
  viewer.clock.multiplier = 1;
  return viewer;
}

// 手动添加底图：优先 ArcGIS 卫星影像，失败回退内置 Natural Earth
export async function loadImagery(viewer) {
  try {
    const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
    );
    viewer.imageryLayers.addImageryProvider(provider);
  } catch (e) {
    console.warn("ArcGIS 卫星底图加载失败，使用内置 Natural Earth 兜底", e);
    try {
      const fallback = await Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
      );
      viewer.imageryLayers.addImageryProvider(fallback);
    } catch (e2) {
      console.error("底图兜底也失败", e2);
    }
  }
}

// 重置镜头：北极朝上、地面站经线正对屏幕（相机位于赤道、地面站经度处，正视地心）
export function resetCamera(viewer, lon, cameraDistM) {
  if (!viewer) return;
  viewer.camera.setView({
    // 放在赤道、地面站经度上，使整条经线（含地面站）正对屏幕中央
    destination: Cesium.Cartesian3.fromDegrees(lon, 0, cameraDistM),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90), // 看向地心（正下方），屏幕上方即北极
      roll: 0,
    },
  });
}

// 惯性视角下每帧保持相机位于惯性参考系：地球自转，轨道相对星空固定。
// 返回的更新函数供 scene.postUpdate 挂载/卸载；eciRef 用于读取最新 eci 状态。
export function createInertialCameraUpdate(eciRef) {
  return (scene, time) => {
    if (!eciRef.current) return;
    const m = Cesium.Transforms.computeIcrfToFixedMatrix(time);
    if (!m) return;
    const camera = scene.camera;
    const offset = Cesium.Cartesian3.clone(camera.position);
    camera.lookAtTransform(
      Cesium.Matrix4.fromRotationTranslation(m, Cesium.Cartesian3.ZERO),
      offset
    );
  };
}

// 切换底图（satvis 风格多底图）：'satellite' 卫星影像 / 'street' 街道 / 'terrain' 地形晕渲 /
// 'dark' 暗色 / 'light' 浅灰 / 'nature' 自然(NASA Blue Marble) / 'blackmarble' 夜光(NASA Black Marble) / 'none' 无
// 加载为异步，带失败兜底（内置 Natural Earth 贴图）。
export function setBasemap(viewer, kind) {
  if (!viewer) return;
  const layers = viewer.imageryLayers;
  layers.removeAll();
  let p = null;
  if (kind === "street") {
    // Cesium 1.144：OpenStreetMapImageryProvider 仅支持构造函数（无 fromUrl 静态方法）
    p = new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" });
  } else if (kind === "terrain") {
    p = Cesium.ArcGisMapServerImageryProvider.fromUrl(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Hillshade/MapServer"
    );
  } else if (kind === "satellite") {
    p = Cesium.ArcGisMapServerImageryProvider.fromUrl(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
    );
  } else if (kind === "dark") {
    // CARTO 暗色底图（无需 key，天然适合与高亮卫星区分）
    p = new Cesium.UrlTemplateImageryProvider({
      url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      credit: "© OpenStreetMap © CARTO",
      maximumLevel: 19,
    });
  } else if (kind === "light") {
    // CARTO 浅灰底图（与 OL 引擎的 light 浅灰样式同源）
    p = new Cesium.UrlTemplateImageryProvider({
      url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      credit: "© OpenStreetMap © CARTO",
      maximumLevel: 19,
    });
  } else if (kind === "nature") {
    // NASA Blue Marble 全球影像（GIBS 公开服务，无需 key，色彩鲜艳）。
    // 之前用 Cesium 内置 Natural Earth II 贴图：低饱和度、偏灰白，观感不如 satvis。
    // WMTS epsg3857 + GoogleMapsCompatible 网格 = 标准 WebMercator z/y/x；无时间维度。
    p = new Cesium.UrlTemplateImageryProvider({
      url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
      maximumLevel: 8,
      credit: "© NASA Blue Marble",
    });
  } else if (kind === "blackmarble") {
    // NASA GIBS 夜光影像（VIIRS Black Marble）。公开服务（best 档）仅提供 2012 / 2016 两个
    // 年度合成（日合成需 epsg4326 + 额外处理），这里固定取最新的 2016 版全球夜景。
    // WMTS epsg3857 + GoogleMapsCompatible 网格 = 标准 WebMercator z/y/x，Cesium 可直接用。
    p = new Cesium.UrlTemplateImageryProvider({
      url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
      maximumLevel: 8,
      credit: "© NASA GIBS Black Marble",
    });
  } else {
    return; // none：移除全部底图，仅显示地球本体 / 星空
  }
  Promise.resolve(p)
    .then((provider) => layers.addImageryProvider(provider))
    .catch(() => {
      try {
        layers.addImageryProvider(
          Cesium.TileMapServiceImageryProvider.fromUrl(
            Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
          )
        );
      } catch (_) {
        /* 忽略兜底失败 */
      }
    });
}

// 场景视图切换：'3d' 球体 / '2d' 平面 / 'columbus' 哥伦布视图（2.5D 展开）
export function setSceneMode(viewer, mode) {
  if (!viewer) return;
  const scene = viewer.scene;
  if (mode === "2d") scene.morphTo2D();
  else if (mode === "columbus") scene.morphToColumbusView();
  else scene.morphTo3D();
}

// 星空（天球背景 + 大气）显隐开关
export function setSkyOption(viewer, show) {
  if (!viewer) return;
  const scene = viewer.scene;
  if (scene.skyBox) scene.skyBox.show = show;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = show;
}
