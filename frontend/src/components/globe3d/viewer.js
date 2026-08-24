// globe3d 子模块：Cesium Viewer 生命周期与相机管理
// Cesium 通过 cesiumGlobal 惰性代理访问（运行时已加载），避免静态打包。
import { Cesium } from "./cesiumGlobal.js";

// 创建 Viewer（统一隐藏控件/关闭默认底图，底图由 loadImagery 手动添加）
export function createViewer(container) {
  const viewer = new Cesium.Viewer(container, {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    baseLayer: false, // 不创建默认底图，下面手动添加（避免 imageryProvider+baseLayer 冲突导致无贴图）
  });
  viewer.cesiumWidget.creditContainer.style.display = "none"; // 隐藏版权条（仅界面清爽）
  viewer.scene.globe.enableLighting = true; // 开启光照，太阳方位随时间变化时地表明暗随之变化
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 8e7;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 10000;
  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = Cesium.JulianDate.now(); // 初始时钟设为当前时刻
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
