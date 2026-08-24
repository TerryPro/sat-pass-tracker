import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// Cesium 静态资源：开发/构建都从 node_modules/cesium/Build/Cesium 取用，
// 由浏览器端 cesiumGlobal.js 在进入 3D 时按需 <script>/<link> 加载，
// 避免 vite-plugin-cesium 将约 6MB 的 Cesium 以同步脚本注入 index.html 阻塞首屏。
const CESIUM_DIR = path.resolve(
  process.cwd(),
  "node_modules",
  "cesium",
  "Build",
  "Cesium"
);

const MIME_MAP = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
};

function mimeFor(p) {
  return MIME_MAP[path.extname(p).toLowerCase()] || "application/octet-stream";
}

// 手动 Cesium 静态资源插件（等价替代 vite-plugin-cesium）
function cesiumStatic() {
  return {
    name: "cesium-static",
    // 开发：把 /cesium/* 映射到 Cesium 产物目录的静态中间件（读自 node_modules，不经 Vite 打包）
    configureServer(server) {
      server.middlewares.use("/cesium", (req, res, next) => {
        const urlPath = decodeURIComponent((req.url || "").split("?")[0]);
        const full = path.normalize(path.join(CESIUM_DIR, urlPath));
        // 防目录穿越：确保解析结果仍在 Cesium 目录内
        if (full !== CESIUM_DIR && !full.startsWith(CESIUM_DIR + path.sep)) {
          return next();
        }
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          res.setHeader("Content-Type", mimeFor(full));
          fs.createReadStream(full).pipe(res);
        } else {
          next();
        }
      });
    },
    // 构建：把 Cesium 产物原样复制到 dist/cesium，配合 /cesium/ 基址按需加载
    closeBundle() {
      const out = path.resolve(process.cwd(), "dist", "cesium");
      fs.cpSync(CESIUM_DIR, out, { recursive: true });
    },
  };
}

// 开发时把 /api 与 /socket.io 代理到 FastAPI 后端（standalone/backend）
// 端口与代理目标可通过 frontend/.env 配置（见 .env.example）：
//   VITE_DEV_PORT=5173
//   VITE_API_PROXY_TARGET=http://localhost:8765
export default defineConfig(({ mode }) => {
  // 第三个参数 "" 表示加载全部环境变量（含非 VITE_ 前缀，供本配置文件使用）
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.VITE_DEV_PORT || 5173);
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8765";

  return {
    plugins: [react(), cesiumStatic()],
    server: {
      port,
      host: true,
      // 放行仓库根目录（standalone/VERSION 供版本号读取）
      fs: { allow: [".."] },
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/socket.io": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});