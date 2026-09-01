// 惯性坐标系：每帧把相机变换到 ICRF 参考系，使地球自转、轨道/卫星相对星空固定。
// 仅 frame=inertial 且 3D 视图时生效；切换离开时还原相机到地固参考系。
import { useEffect } from "react";
import { Cesium } from "./cesiumGlobal.js";

export function useInertialCamera({ viewerRef, state, frame, viewMode }) {
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
  }, [viewerRef, state, frame, viewMode]);
}
