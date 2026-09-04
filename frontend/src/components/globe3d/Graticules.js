// 经纬网（Graticule）：移植自 github.com/hongfaqiu/cesium-graticule（MIT License）。
// 原库为 TS 且 `import ... from "cesium"`（ESM 静态导入），会与本项目「懒加载 + 全局 window.Cesium」
// 的架构产生第二份 Cesium 实例冲突。此处保留其算法与实现，仅把 Cesium 类改为从 cesiumGlobal.js
// 的惰性代理读取（业务代码必须等 loadCesium() 完成、viewer 已用全局 Cesium 创建后才能实例化）。
// 实现要点：用 PolylineCollection + LabelCollection 两根 primitive 集合绘制经纬线，
// 监听 camera.changed 与容器 resize，按视口自适应网格间隔并生成 DMS 度分秒标签。
import { Cesium } from "./cesiumGlobal.js";

// 网格间隔（度）：随缩放自适应，从小到大。注意：不能在模块顶层调用 Cesium 惰性代理
// （import/求值发生在 loadCesium() 完成前，会抛"Cesium 尚未加载完成"）。
// 因此这里只存角度值，到构造函数（此时 Viewer 已就绪）再转为弧度。
const MIN_DEGREES = [0.00675, 0.0125, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0];

function gridPrecision(dDeg) {
  if (dDeg < 0.01) return 3;
  if (dDeg < 0.1) return 2;
  if (dDeg < 1) return 1;
  return 0;
}

// 数值 → DMS 文本（如 45°30'N / 120°15'30"E），isLat 决定后缀 N/S 或 E/W
function convertDEGToDMS(deg, isLat) {
  const absolute = Math.abs(deg);
  const degrees = ~~absolute;
  const minutesNotTruncated = Math.round((absolute - degrees) * 600) / 10;
  const minutes = ~~minutesNotTruncated;
  const seconds = ((minutesNotTruncated - minutes) * 60).toFixed(0);
  let minSec = "";
  if (minutes || seconds !== "0") minSec += minutes + "'";
  if (seconds !== "0") minSec += seconds + '"';
  return `${degrees}°${minSec.padStart(2, "0")}${isLat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W"}`;
}

export default class Graticules {
  constructor(viewer, options = {}) {
    if (!viewer) throw new Error("undefined viewer");
    this._viewer = viewer;
    this._scene = viewer.scene;
    this._color = options.color ?? Cesium.Color.WHITE.withAlpha(0.5);
    this._meridiansColor = options.meridiansColor ?? Cesium.Color.YELLOW;
    this._gridCount = options.gridCount || 15;
    this._meridians = options.meridians ?? true;
    this._labelOptions = {
      font: "bold 1rem Arial",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      ...options.labelOptions,
    };
    this._labels = new Cesium.LabelCollection();
    viewer.scene.primitives.add(this._labels);
    this._polylines = new Cesium.PolylineCollection();
    viewer.scene.primitives.add(this._polylines);
    this._ellipsoid = viewer.scene.globe.ellipsoid;
    this._lastRefresh = 0;
    this._debounce = 500;
    this._granularity = Cesium.Math.toRadians(3);
    // 延迟计算网格间隔（弧度）：此刻 viewer 已用全局 Cesium 创建，惰性代理可用
    this._mins = MIN_DEGREES.map((v) => Cesium.Math.toRadians(v));
    this._destroyed = false;
    this._currentExtent = null;
    this._visible = false;
    this.show();
  }

  get visible() {
    return this._visible;
  }
  set visible(val) {
    if (this._visible === val) return;
    if (val === false) {
      this.hide();
    } else {
      this.show();
    }
  }
  get isDestroyed() {
    return this._destroyed;
  }

  // 视口四角在地球上的范围（矩形）；任一角未命中返回最大范围（避免 NaN）
  _getExtentView() {
    const camera = this._scene.camera;
    const canvas = this._scene.canvas;
    const corners = [
      camera.pickEllipsoid(new Cesium.Cartesian2(0, 0), this._ellipsoid),
      camera.pickEllipsoid(new Cesium.Cartesian2(canvas.clientWidth, 0), this._ellipsoid),
      camera.pickEllipsoid(new Cesium.Cartesian2(0, canvas.clientHeight), this._ellipsoid),
      camera.pickEllipsoid(new Cesium.Cartesian2(canvas.clientWidth, canvas.clientHeight), this._ellipsoid),
    ];
    for (let index = 0; index < 4; index++) {
      if (corners[index] === undefined) {
        return Cesium.Rectangle.MAX_VALUE;
      }
    }
    return Cesium.Rectangle.fromCartographicArray(
      this._ellipsoid.cartesianArrayToCartographicArray(corners)
    );
  }

  // 视口内四条采样边对应的经纬范围，用于标签贴边
  _getScreenViewRange() {
    const camera = this._scene.camera;
    const canvas = this._scene.canvas;
    const height = camera.positionCartographic.height;
    let offsetX = 40;
    let offsetY = 20;
    if (height < 36000) {
      offsetX = 60;
    }
    const corners = {
      north: camera.pickEllipsoid(new Cesium.Cartesian2(canvas.clientWidth / 2, offsetY), this._ellipsoid),
      south: camera.pickEllipsoid(
        new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight - offsetY),
        this._ellipsoid
      ),
      west: camera.pickEllipsoid(new Cesium.Cartesian2(offsetX, canvas.clientHeight / 2), this._ellipsoid),
      east: camera.pickEllipsoid(
        new Cesium.Cartesian2(canvas.clientWidth - offsetX, canvas.clientHeight / 2),
        this._ellipsoid
      ),
    };
    return {
      north: corners.north ? Cesium.Cartographic.fromCartesian(corners.north).latitude : undefined,
      south: corners.south ? Cesium.Cartographic.fromCartesian(corners.south).latitude : undefined,
      west: corners.west ? Cesium.Cartographic.fromCartesian(corners.west).longitude : undefined,
      east: corners.east ? Cesium.Cartographic.fromCartesian(corners.east).longitude : undefined,
    };
  }

  // 屏幕中心对应的地表位置，用于决定标签语种/边界判断
  _screenCenterPosition() {
    const canvas = this._scene.canvas;
    const center = new Cesium.Cartesian2(Math.round(canvas.clientWidth / 2), Math.round(canvas.clientHeight / 2));
    let cartesian = this._scene.camera.pickEllipsoid(center);
    if (!cartesian) cartesian = Cesium.Cartesian3.fromDegrees(0, 0, 0);
    return cartesian;
  }

  _makeLabel(lng, lat, text, isLat) {
    if (this._meridians) {
      if (text === "0°00N") text = "Equator";
      if (text === "0°00E") text = "Prime Meridian";
      if (text === "180°00W" || text === "180°00E") text = "Antimeridian";
    }
    const range = this._getScreenViewRange();
    const center = Cesium.Cartographic.fromCartesian(this._screenCenterPosition());
    const carto = new Cesium.Cartographic(lng, lat);
    const addLabel = (c, isLatFlag, pos) => {
      const position = this._ellipsoid.cartographicToCartesian(c);
      const label = this._labels.add({
        position,
        text,
        pixelOffset: new Cesium.Cartesian2(isLatFlag ? 0 : 4, isLatFlag ? -6 : 0),
        eyeOffset: Cesium.Cartesian3.ZERO,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: isLatFlag ? Cesium.VerticalOrigin.BOTTOM : Cesium.VerticalOrigin.TOP,
        scaleByDistance: new Cesium.NearFarScalar(1, 0.85, 8.0e6, 0.75),
        ...this._labelOptions,
      });
      label.isLat = isLatFlag;
      label.pos = pos;
      return label;
    };
    if (isLat) {
      if (range.east === undefined && range.west === undefined) {
        carto.longitude = center.longitude;
        addLabel(carto, isLat, "center");
      } else {
        ["east", "west"].forEach((item) => {
          if (range[item]) {
            carto.longitude = range[item];
            addLabel(carto, isLat, item);
          }
        });
      }
    } else {
      if (range.south === undefined && range.north === undefined) {
        carto.latitude = center.latitude;
        addLabel(carto, isLat, "center");
      } else {
        ["south", "north"].forEach((item) => {
          if (range[item]) {
            carto.latitude = range[item];
            addLabel(carto, isLat, item);
          }
        });
      }
    }
  }

  // 视口移动时更新标签贴边位置（经纬线多边形不变，只挪标签坐标）
  _updateLabelPositions() {
    const range = this._getScreenViewRange();
    const center = Cesium.Cartographic.fromCartesian(this._screenCenterPosition());
    const len = this._labels.length;
    for (let i = 0; i < len; ++i) {
      const b = this._labels.get(i);
      const carto = Cesium.Cartographic.fromCartesian(b.position);
      if (b.isLat) carto.longitude = range[b.pos] ? range[b.pos] : center.longitude;
      else carto.latitude = range[b.pos] ? range[b.pos] : center.latitude;
      b.position = this._ellipsoid.cartographicToCartesian(carto);
    }
  }

  _drawGrid(extent) {
    if (!extent) extent = this._getExtentView();
    const { MAX_VALUE } = Cesium.Rectangle;
    const center = Cesium.Cartographic.fromCartesian(this._screenCenterPosition());
    let wrapLng = undefined;
    let { east, west, south, north } = extent;
    // 处理跨越反经线的边界异常
    if (center.longitude > east && center.longitude < west && east < west) {
      [east, west] = [west, east];
    }
    if ((west < east) && ((center.longitude > east && center.longitude > west) || (center.longitude < east && center.longitude < west))) {
      [east, west] = [west, east];
    }
    if (east < west) {
      wrapLng = MAX_VALUE.east + Math.abs(-MAX_VALUE.east - east);
    }
    this._polylines.removeAll();
    this._labels.removeAll();
    let dLat = this._mins[0];
    let dLng = this._mins[0];
    let index;
    // 取最接近使视口网格数约 gridCount 的间隔
    for (index = 0; index < this._mins.length && dLat < (north - south) / this._gridCount; index++) {
      dLat = this._mins[index];
    }
    for (index = 0; index < this._mins.length && dLng < ((wrapLng === undefined ? east : wrapLng) - west) / this._gridCount; index++) {
      dLng = this._mins[index];
    }
    // 高纬地区使用纬线自身间隔（避免经线过密）
    if (center.latitude > Cesium.Math.toRadians(75) || center.latitude < Cesium.Math.toRadians(-75)) {
      // 空：高纬保持 dLng 与 dLat 各自间隔
    } else if (dLng !== dLat) {
      dLng = dLat = Math.min(dLat, dLng);
    }
    // 把迭代起始对齐到网格间隔
    let minLng = ~~(west / dLng) * dLng;
    let maxLng = ~~(east / dLng) * dLng;
    let minLat = ~~(south / dLat) * dLat;
    let maxLat = ~~(north / dLat) * dLat;
    // 外扩两格 + 夹到球面合理范围，覆盖瓦片未刷新区域
    minLng = Math.max(minLng - 2 * dLng, -Math.PI);
    maxLng = Math.min(maxLng + 2 * dLng, Math.PI);
    minLat = Math.max(minLat - 2 * dLat, -Math.PI / 2);
    maxLat = Math.min(maxLat + 2 * dLat, Math.PI / 2);
    let lat;
    let lng;
    const lineGraphicsObj = (positions, color) => ({
      positions,
      width: 0.5,
      material: Cesium.Material.fromType("Color", { color }),
    });
    // 经线
    const latitudeText = minLat + ~~((maxLat - minLat) / dLat / 2) * dLat;
    let tLng = wrapLng === undefined ? maxLng : wrapLng;
    let countLng = 0;
    for (let _lng = minLng; _lng < tLng - dLng; _lng += dLng) {
      if (maxLng > MAX_VALUE.east) {
        lng = east - (_lng - MAX_VALUE.east);
      } else {
        lng = _lng;
      }
      lng = (lng + Cesium.Math.PI) % (Cesium.Math.PI * 2) - Cesium.Math.PI;
      const path = [];
      for (lat = minLat; lat < maxLat; lat += this._granularity) {
        path.push(new Cesium.Cartographic(lng, lat));
      }
      path.push(new Cesium.Cartographic(lng, maxLat));
      const degLng = Cesium.Math.toDegrees(lng);
      const text = convertDEGToDMS(+degLng.toFixed(gridPrecision(dLng)), false);
      const color =
        (text === "0°00E" || text === "180°00W" || text === "180°00E") && this._meridians
          ? this._meridiansColor
          : this._color;
      if (text) {
        this._polylines.add(lineGraphicsObj(this._ellipsoid.cartographicArrayToCartesianArray(path), color));
        if (countLng % 2) {
          this._makeLabel(lng, latitudeText, text, false);
        }
        countLng++;
      }
    }
    // 纬线
    const longitudeText = minLng + ~~((tLng - minLng) / dLng / 2) * dLng;
    let countLat = 0;
    for (lat = minLat; lat < maxLat; lat += dLat) {
      const path = [];
      for (lng = minLng; lng < tLng; lng += this._granularity) {
        path.push(new Cesium.Cartographic(lng, lat));
      }
      path.push(new Cesium.Cartographic(maxLng, lat));
      const degLat = Cesium.Math.toDegrees(lat);
      const text = convertDEGToDMS(+degLat.toFixed(gridPrecision(dLat)), true);
      const color = text === "0°00N" && this._meridians ? this._meridiansColor : Cesium.Color.WHITE.withAlpha(0.5);
      this._polylines.add(lineGraphicsObj(this._ellipsoid.cartographicArrayToCartesianArray(path), color));
      if (countLat % 2) {
        this._makeLabel(longitudeText, lat, text, true);
      }
      countLat++;
    }
  }

  _render = () => {
    const now = new Date().getTime();
    if (now - this._lastRefresh < this._debounce) return;
    this._updateLabelPositions();
    let extent = this._getExtentView();
    let shouldRefresh = true;
    if (this._currentExtent) {
      const w = Math.abs(extent.west - this._currentExtent.west);
      const s = Math.abs(extent.south - this._currentExtent.south);
      const e = Math.abs(extent.east - this._currentExtent.east);
      const n = Math.abs(extent.north - this._currentExtent.north);
      const m = 0.0001;
      if (w < m && s < m && e < m && n < m) shouldRefresh = false;
    }
    if (!shouldRefresh && this._labels.length) return;
    this._currentExtent = extent;
    this._drawGrid(extent);
  };

  show() {
    this._viewer.camera.percentageChanged = 0.01;
    this._viewer.scene.camera.changed.addEventListener(this._render);
    this._viewer.container.addEventListener("resize", this._render);
    this._render();
    this._visible = true;
    this._scene.requestRender();
  }

  hide() {
    if (this._viewer.isDestroyed()) return;
    this._polylines.removeAll();
    this._labels.removeAll();
    this._viewer.scene.camera.changed.removeEventListener(this._render);
    this._viewer.container.removeEventListener("resize", this._render);
    this._visible = false;
    this._scene.requestRender();
  }

  destroy() {
    this.hide();
    // 卸载时从场景移除 primitive 集合（而非仅清空内容），
    // 避免复用 viewer 时残留两个空集合占用场景资源。
    try {
      this._scene.primitives.remove(this._polylines);
      this._scene.primitives.remove(this._labels);
    } catch (_) {
      /* viewer 已销毁，场景已随之释放，忽略 */
    }
    this._destroyed = true;
    this.show = undefined;
    this.hide = undefined;
  }
}