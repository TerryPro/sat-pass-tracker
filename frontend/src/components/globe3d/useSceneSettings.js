// 应用场景与底图设置（3D/2D/哥伦布、底图、星空、HDR、大气、光照）到已创建的 viewer。
import { useEffect } from "react";
import { setBasemap, setSceneMode, setSkyOption } from "./viewer.js";

export function useSceneSettings({
  viewerRef, state,
  viewMode, basemap, skyOn, hdr, atmosphere, lighting,
}) {
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || state !== "ready") return;
    setSceneMode(viewer, viewMode);
    setSkyOption(viewer, skyOn);
    setBasemap(viewer, basemap);
    viewer.scene.highDynamicRange = hdr;
    viewer.scene.skyAtmosphere.show = atmosphere;
    viewer.scene.globe.enableLighting = lighting;
  }, [viewerRef, state, viewMode, basemap, skyOn, hdr, atmosphere, lighting]);
}
