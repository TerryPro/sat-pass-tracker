// 底图瓦片源配置与创建（OpenLayers）
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";

// 当前是否暗色主题（theme.js 在 <html> 上写入 data-theme；地图样式按主题取色）
export function mapIsDark() {
  return typeof document !== "undefined" && document.documentElement.dataset.theme !== "light";
}

// 底图样式配置：key → { label, url, attributions }
export const MAP_STYLES = {
  natural_earth: {
    label: "自然地球 II",
    url: "https://papers.reearth.land/ne2/{z}/{x}/{y}.webp",
    attributions: "© Natural Earth (public domain)",
    maxZoom: 6, // Re:Earth Papers ne2 在线源原生支持 z0-z6，z7+ 无瓦片
  },
  dark: {
    label: "暗色",
    url: "https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attributions: "© CARTO © OpenStreetMap contributors",
  },
  light: {
    label: "浅灰",
    url: "https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attributions: "© CARTO © OpenStreetMap contributors",
  },
  satellite: {
    label: "卫星",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attributions: "© Esri, Maxar, Earthstar Geographics",
  },
  terrain: {
    label: "地形",
    url: "https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attributions: "© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors",
  },
  standard: {
    label: "标准",
    url: null, // 用 OSM 默认源
    attributions: "© OpenStreetMap contributors",
  },
};

// 根据样式 key 创建瓦片 source（不创建整个 layer，便于后续切换）
export function createTileSource(styleKey) {
  const cfg = MAP_STYLES[styleKey] || MAP_STYLES.dark;
  if (!cfg.url) return new OSM();
  return new XYZ({
    url: cfg.url,
    attributions: cfg.attributions,
    crossOrigin: "anonymous",
    ...(cfg.maxZoom ? { maxZoom: cfg.maxZoom } : {}),
  });
}
