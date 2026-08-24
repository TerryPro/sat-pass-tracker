// Cesium 懒加载与全局引用管理
// 背景：vite-plugin-cesium 会把 Cesium 以同步 <script> 注入 index.html，阻塞首屏。
// 这里改为：仅在 3D 视图首次挂载时动态注入 Cesium.js + widgets.css（见 loadCesium），
// 并导出一个惰性 `Cesium` 代理——业务模块仍可用 Cesium.X 语法，但属性在访问时才转发
// 到已加载的全局对象，从而完全脱离首屏加载。

let _Cesium = null; // 已加载的全局 Cesium 对象
let _loading = null; // 进行中的 loadCesium Promise（避免重复加载）

export function setCesium(c) {
  _Cesium = c;
}

function getCesium() {
  if (!_Cesium) throw new Error("Cesium 尚未加载完成，请先 await loadCesium()");
  return _Cesium;
}

// 惰性代理：属性访问转发到全局 Cesium（使 coords/viewer/render 可保持 Cesium.X 写法）
export const Cesium = new Proxy(
  {},
  {
    get(_, prop) {
      return getCesium()[prop];
    },
    set(_, prop, v) {
      getCesium()[prop] = v;
      return true;
    },
    has(_, prop) {
      return prop in getCesium();
    },
  }
);

// 动态加载 Cesium（全局脚本 + 样式），返回 Promise<Cesium>；多次调用复用同一加载
export function loadCesium() {
  if (_Cesium) return Promise.resolve(_Cesium);
  if (_loading) return _loading;
  if (typeof window !== "undefined" && window.Cesium) {
    setCesium(window.Cesium);
    return Promise.resolve(window.Cesium);
  }

  _loading = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/cesium/Widgets/widgets.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "/cesium/Cesium.js";
    script.async = true;
    script.onload = () => {
      const C = window.Cesium;
      if (!C) {
        reject(new Error("Cesium 已加载但全局对象缺失"));
        return;
      }
      // 显式指定资源基址，确保 Workers / Assets 等静态资源从 /cesium/ 下解析。
      // 注意：buildModuleUrl 是只读 getter（仅暴露 setBaseUrl 方法），不可直接赋值。
      if (C.buildModuleUrl && typeof C.buildModuleUrl.setBaseUrl === "function") {
        C.buildModuleUrl.setBaseUrl("/cesium/");
      } else {
        C.buildModuleUrl = "/cesium/";
      }
      setCesium(C);
      resolve(C);
    };
    script.onerror = () => reject(new Error("Cesium 脚本加载失败"));
    document.head.appendChild(script);
  }).finally(() => {
    _loading = null;
  });
  return _loading;
}