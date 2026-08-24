// 经纬网绘制（OpenLayers）：按缩放级别选步长，网格线 + 经纬度标签 + 国际日期变更线
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import { Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat, transformExtent } from "ol/proj";
import { mapIsDark } from "./mapStyles.js";

// 根据当前缩放级别挑选合适的网格步长（度）
export function pickStep(zoom) {
  if (zoom <= 1.5) return 30;
  if (zoom <= 2.2) return 20;
  if (zoom <= 3.2) return 15;
  if (zoom <= 4.5) return 10;
  if (zoom <= 6) return 5;
  return 2;
}

/**
 * 在 OpenLayers 地图上绘制经纬网。
 * @param {object} p
 * @param {import("ol/Map").default} p.map 地图实例
 * @param {import("ol/source/Vector").default} p.source 经纬网图层 source（会先 clear）
 * @param {string} p.proj 投影（EPSG:4326 / EPSG:3857）
 */
export function drawGridOnMap({ map, source, proj }) {
  if (!source || !map) return;
  source.clear();

  // 配色随主题：暗色底图用亮色线条/白字黑晕，亮色底图用深色线条/红字白晕
  const dark = mapIsDark();
  const cLat = dark ? "rgba(255,200,80,0.85)" : "rgba(160,110,0,0.8)";      // 纬线
  const cEquator = dark ? "rgba(255,255,255,0.95)" : "rgba(40,40,40,0.85)";  // 赤道
  const cLon = dark ? "rgba(80,200,255,0.85)" : "rgba(0,110,190,0.8)";       // 经线
  const cDateline = dark ? "rgba(220,190,255,0.95)" : "rgba(110,70,190,0.85)"; // 日期线
  const labelStroke = new Stroke({ color: dark ? "#000000" : "#ffffff", width: dark ? 3 : 4 });
  const labelFill = new Fill({ color: dark ? "#FF4444" : "#c81e1e" });

  const zoom = map.getView().getZoom() ?? 1;
  const step = pickStep(zoom);
  const is4326 = proj === "EPSG:4326";
  const toCoord = (lon, lat) => (is4326 ? [lon, lat] : fromLonLat([lon, lat]));

  // —— 计算当前视窗范围（4326 经纬度），把标签贴在左边缘、下边缘
  const size = map.getSize();
  let vMinLon = -180, vMaxLon = 180, vMinLat = -85, vMaxLat = 85;
  if (size) {
    try {
      const extProj = map.getView().calculateExtent(size);
      const ext4326 = is4326 ? extProj : transformExtent(extProj, "EPSG:3857", "EPSG:4326");
      vMinLon = ext4326[0]; vMinLat = ext4326[1]; vMaxLon = ext4326[2]; vMaxLat = ext4326[3];
      // 钳制，避免异常值
      vMinLon = Math.max(-180, Math.min(180, vMinLon));
      vMaxLon = Math.max(-180, Math.min(180, vMaxLon));
      vMinLat = Math.max(-90, Math.min(90, vMinLat));
      vMaxLat = Math.max(-90, Math.min(90, vMaxLat));
    } catch (_) { /* ignore */ }
  }

  // 1) 纬度线（纬线，horizontal）：-90 ~ 90，按 step 间隔
  for (let lat = -90; lat <= 90; lat += step) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 2) pts.push(toCoord(lon, lat));
    const f = new Feature(new LineString(pts));
    const isEquator = lat === 0;
    f.setStyle(
      new Style({
        stroke: new Stroke({
          // 普通纬线：黄橙色；赤道高亮（暗色底图纯白 / 亮色底图深灰）
          color: isEquator ? cEquator : cLat,
          width: isEquator ? 1.6 : 1.1,
          lineDash: isEquator ? undefined : [5, 4],
        }),
      })
    );
    source.addFeature(f);
  }

  // 2) 经度线（经线，vertical）：-180 ~ 180
  const latMax = is4326 ? 90 : 85;
  for (let lon = -180; lon <= 180; lon += step) {
    const pts = [];
    for (let lat = -latMax; lat <= latMax; lat += 2) pts.push(toCoord(lon, lat));
    const f = new Feature(new LineString(pts));
    const isDateline = lon === -180 || lon === 180;
    f.setStyle(
      new Style({
        stroke: new Stroke({
          // 普通经线：青色；国际日期变更线：淡紫白高亮
          color: isDateline ? cDateline : cLon,
          width: isDateline ? 1.6 : 1.1,
          lineDash: isDateline ? [7, 5] : [5, 4],
        }),
      })
    );
    source.addFeature(f);
  }

  // 3) 纬度标签：贴在视窗左边缘
  const lonPad = (vMaxLon - vMinLon) * 0.012; // 离左边界留 1.2% 的边距
  const labelLon = Math.max(-180, Math.min(180, vMinLon + lonPad));
  for (let lat = -90; lat <= 90; lat += step) {
    if (lat === 0) continue;
    if (lat < vMinLat - step / 2 || lat > vMaxLat + step / 2) continue; // 只画可见范围附近
    const f = new Feature(new Point(toCoord(labelLon, lat)));
    f.setStyle(
      new Style({
        text: new Text({
          text: `${lat.toFixed(0)}°`,
          font: "bold 12px sans-serif",
          fill: labelFill,
          stroke: labelStroke,
          opacity: 0.95,
          textAlign: "left",
          offsetX: 2,
          offsetY: 0,
        }),
      })
    );
    source.addFeature(f);
  }

  // 4) 经度标签：贴在视窗下边缘
  const latPad = (vMaxLat - vMinLat) * 0.02; // 离下边界留 2% 的边距
  const labelLat = Math.max(-90, Math.min(90, vMinLat + latPad));
  for (let lon = -180; lon <= 180; lon += step) {
    if (lon === 0) continue;
    if (lon < vMinLon - step / 2 || lon > vMaxLon + step / 2) continue;
    const f = new Feature(new Point(toCoord(lon, labelLat)));
    f.setStyle(
      new Style({
        text: new Text({
          text: `${lon.toFixed(0)}°`,
          font: "bold 12px sans-serif",
          fill: labelFill,
          stroke: labelStroke,
          opacity: 0.95,
          textAlign: "center",
          offsetY: 2,
        }),
      })
    );
    source.addFeature(f);
  }

  // 赤道 0°（纬度）单独标：放在左边缘
  if (0 >= vMinLat - step / 2 && 0 <= vMaxLat + step / 2) {
    const eqF = new Feature(new Point(toCoord(labelLon, 0)));
    eqF.setStyle(
      new Style({
        text: new Text({
          text: "0°",
          font: "bold 12px sans-serif",
          fill: labelFill,
          stroke: labelStroke,
          opacity: 0.95,
          textAlign: "left",
          offsetX: 2,
        }),
      })
    );
    source.addFeature(eqF);
  }
  // 0° 经度单独标：放在下边缘
  if (0 >= vMinLon - step / 2 && 0 <= vMaxLon + step / 2) {
    const gF = new Feature(new Point(toCoord(0, labelLat)));
    gF.setStyle(
      new Style({
        text: new Text({
          text: "0°",
          font: "bold 12px sans-serif",
          fill: labelFill,
          stroke: labelStroke,
          opacity: 0.95,
          textAlign: "center",
          offsetY: 2,
        }),
      })
    );
    source.addFeature(gF);
  }
}
