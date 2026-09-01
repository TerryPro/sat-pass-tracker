# 卫星过境跟踪（standalone）

卫星过境跟踪 —— 面向业余无线电卫星（FO-29 / ISS / 中国空间站等）的过境预测与跟踪 Web 应用。

- **后端**：Python + FastAPI + Socket.IO（端口 `8765`），基于 Skyfield 计算过境
- **前端**：React + Vite + MUI + ECharts + OpenLayers + Cesium（端口 `5173`，开发时代理 `/api` 与 `/socket.io` 到后端）

## 目录结构

```
├── backend/                 # FastAPI + Socket.IO 后端
│   ├── app.py               # 入口：组装各模块、CORS、异常处理、health、ASGI 打包
│   ├── config.py            # 环境变量 / .env 配置（监听端口、默认坐标、数据目录）
│   ├── settings.py          # 用户设置路由（读 / 存）
│   ├── satellites.py        # 卫星目录路由（搜索/导入/删除/详情/刷新）
│   ├── passesapi.py         # 过境 / 星下点轨迹路由（薄路由，业务收敛到 passservice）
│   ├── passservice.py       # 过境业务编排（参数解析 / clamp 校验 / 计算 / 状态更新）
│   ├── library.py           # 卫星库路由（数据源组 / 浏览 / 详情 / 档案 / 加入移除）
│   ├── lib.py               # 数据源文件层（CelesTrak 组文件下载与解析，留档于磁盘）
│   ├── astro.py             # 纯计算层（Skyfield：过境 / 星下点 / 实时位置，含模型缓存）
│   ├── provider.py          # 网络数据源层（TLE / SatNOGS 档案 / AMSAT 频率，含内置兜底 TLE）
│   ├── tle.py               # TLE 获取策略与解析（内存 1h → 文件 12h → 联网 / 离线模式）
│   ├── store.py             # 持久化层（设置 / TLE / 卫星信息 JSON 原子读写）
│   ├── state.py             # 应用运行时共享状态（站点配置 + 最新输出，sio 只读）
│   ├── sio.py               # Socket.IO 实时位置广播（专用线程池，不阻塞事件循环）
│   ├── models.py            # pydantic 响应模型（OpenAPI 文档）
│   ├── exceptions.py        # APIError 等业务异常
│   ├── logging_conf.py      # 统一日志格式
│   ├── requirements.txt     # Python 依赖
│   ├── tests/               # pytest 单元/接口测试（离线确定性，不污染真实数据）
│   └── data/                # 运行时数据（不入库）：settings.json / tles.json / satellite_info.json / satellite_files/
└── frontend/                # React + Vite 前端
    └── src/
        ├── api/             # REST + Socket.IO 客户端（http.js / socket.js / index.js / library.js）
        ├── slices/          # Redux（track / settings / library）
        ├── pages/           # TrackPage（卫星轨迹）、SatellitePage（卫星管理）、Satellites3DPage（运行态势）、SettingsPage（系统配置）
        ├── components/      # 控制栏、过境列表、极坐标图、2D 地图、时间轴、globe3d（Cesium 3D）等
        ├── hooks/           # usePlayback / useSocket / useGroundData / useEChart 等
        ├── sat/             # 前端卫星计算（satellite.js：轨道要素 / 轨道缓存插值）
        ├── chart/           # ECharts 图表配置（极坐标图 / 甘特图）
        └── config/          # 导航配置
```

## 快速开始

### 后端（端口 8765）

Python 虚拟环境为本仓库独立的 `backend/.venv`（已装好全部依赖；如需重建，安装 `backend/requirements.txt`）：

```bash
cd backend
.venv/Scripts/python.exe -m uvicorn app:sio_app --host 0.0.0.0 --port 8765
```

### 前端（端口 5173）

```bash
cd frontend
npm install     # 首次
npm run dev     # 开发服务器，/api 与 /socket.io 自动代理到 8765
```

访问 **http://localhost:5173**。

### 生产构建

```bash
cd frontend
npm run build        # 产物在 frontend/dist
npm run preview      # 本地预览构建产物
```

## 配置（.env）

监听端口、默认坐标等已抽离为环境变量（后端见 [config.py](backend/config.py)，前端见 [vite.config.js](frontend/vite.config.js)），复制模板并按需修改（`.env` 不入库，`.env.example` 为模板）：

```bash
cp backend/.env.example  backend/.env      # 后端：GS_HOST / GS_PORT / GS_DEFAULT_* / GS_DATA_DIR / GS_CORS_ORIGINS
cp frontend/.env.example frontend/.env     # 前端：VITE_DEV_PORT / VITE_API_PROXY_TARGET / VITE_DEFAULT_*
```

- 后端：真实环境变量优先于 `.env` 文件，全部可省略（省略用代码内默认值）；`.env` 改动需重启后端。CORS 默认只放行本地前端来源（`http://localhost:5173` / `http://127.0.0.1:5173`），跨机部署时用 `GS_CORS_ORIGINS` 显式列出前端来源（逗号分隔；设为 `*` 表示任意来源并自动关闭"携带凭据"）。
- 前端：`.env` 改动需重启 vite；代理目标可指向远程后端（如 `VITE_API_PROXY_TARGET=http://192.168.x.x:8765`）。

## 测试

```bash
# 后端单元/接口测试（backend，pytest）
cd backend
.venv/Scripts/python.exe -m pytest -v

# 前端单元测试（frontend，vitest）
cd frontend
npm test
```

说明：后端测试使用内置历史 TLE（离线、确定性），并把设置/TLE 数据文件重定向到临时目录，不会污染真实运行时数据；前端测试覆盖 `chartUtils` 极坐标映射、`trackSlice` 状态切片、HTTP 与 Socket 客户端。

## 功能一览

- **过境预测**：未来 1~336 小时的过境列表（AOS/LOS、时长、最大仰角、逐样本方位/仰角/斜距），支持任意 NORAD 目录号卫星
- **实时跟踪**：Socket.IO 每 2s 推送卫星当前 az/el/斜距/星下点
- **2D 地图**（OpenLayers）：星下点轨迹、晨昏线（夜影阴影 + 可关闭的橘色虚线分界）、地面站可视范围、经纬网、多投影（EPSG:4326/3857）
- **3D 运行态势**（Cesium）：空间轨道线 + 地表轨迹双线渲染、地面站通视圆、惯性系（ICRF）/ 地固系切换、多底图（卫星/街道/地形/暗色/自然/夜光）、3D/2D/哥伦布视图、卫星名字标签、Cesium 时间控件（UTC/本地）
- **推演回放**：时间轴播放（30×~720× 倍速）、时间-仰角甘特图
- **极坐标图**（ECharts）：AOS/Peak/LOS 标注 + 实时当前位置，采样点明细表
- **卫星管理**：CelesTrak 数据源组下载与浏览、加入/移除卫星、查看轨道根数与档案（SatNOGS + AMSAT）、手动/批量刷新轨道数据、按名称/NORAD 目录号导入
- **设置持久化**：地面站（内置 ON80DD/北京 + 自定义）、默认卫星、时长/采样间隔、主题（暗/亮）、晨昏线虚线开关、界面时间显示时区（UTC/本地）、运行态势轨道线颜色、轨道数据获取模式（在线自动更新 / 内置·本地离线）——保存到 `backend/data/settings.json`，重启保留

## REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/settings` | 读取 / 保存用户设置 |
| GET | `/api/passes?lat=&lon=&alt=&hours=&sample_interval=&horizon=&preset=&satellite=` | 计算过境（`horizon` 为最低仰角掩码，默认 0°，UI 暂未暴露） |
| GET | `/api/groundtrack?lat=&lon=&alt=&hours=&step_sec=&preset=&satellite=` | 计算星下点轨迹 |
| GET | `/api/satellites` | 卫星列表（含 TLE 更新时间/历元） |
| POST | `/api/satellites/search` | 按名称/NORAD 搜索候选卫星 |
| POST | `/api/satellites/import` | 按 NORAD 目录号导入卫星 |
| POST | `/api/satellites/delete` | 删除自定义卫星 |
| GET | `/api/satellites/{id}` | 卫星详情 + 轨道根数解析 |
| GET | `/api/satellites/{id}/info` | 卫星介绍与频率（SatNOGS + AMSAT） |
| POST | `/api/satellites/{id}/refresh` | 强制刷新单颗卫星 TLE |
| POST | `/api/satellites/refresh-all` | 批量刷新全部卫星 TLE |
| GET | `/api/library/meta` | 数据源分类树与本地下载状态 |
| POST | `/api/library/download` | 下载某 CelesTrak 数据源组文件（`{ key }`） |
| GET | `/api/library/entries?q=&source=` | 浏览本地已下载数据源中的卫星（搜索/按来源过滤） |
| GET | `/api/library/detail?norad_id=` | 库内卫星详情（TLE + 轨道根数解析） |
| GET | `/api/library/info?norad_id=&refresh=` | 库内卫星档案（SatNOGS + AMSAT；`refresh=true` 强制联网） |
| POST | `/api/library/activate` | 把库内卫星加入"已加入"列表（`{ norad_id }`） |
| POST | `/api/library/deactivate` | 从"已加入"列表移除（`{ id }`） |

### Socket.IO 事件

| 事件 | 方向 | 数据 |
| --- | --- | --- |
| `connect` | 客户端→服务端 | 服务端立即回发 `state` |
| `state` | 服务端→客户端 | `{ station, position }` 当前站点配置 + 最新位置 |
| `satellite:position` | 服务端→客户端 | 每 2s 广播 `{ t, az, el, r_km, lat, lon, alt_km }` |

## 数据与缓存

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 用户设置 | `backend/data/settings.json` | 坐标/卫星/时长/主题/时间显示/轨道颜色/轨道数据模式等 |
| TLE 缓存 | `backend/data/tles.json` | 内存 1h + 文件 12h 有效；`tle_mode=builtin`（离线）时跳过联网，直接用缓存或内置 TLE |
| 卫星信息缓存 | `backend/data/satellite_info.json` | SatNOGS 元数据 30 天有效 |
| AMSAT 频率 | 内存 | 24h 过期重新拉取 |
| 数据源组文件 | `backend/data/satellite_files/<key>.tle` | 下载的 CelesTrak 原始 3LE 文件，留档并供浏览/加入 |

TLE 在线源：SatNOGS → CelesTrak；全部失败时回退到内置历史 TLE（`provider.py` 内置：FO-29 / ISS / 中国空间站）。内置卫星：FO-29 (24278)、ISS (25544)、中国空间站 (48274)。轨道数据获取模式可在系统配置页切换：在线自动更新（默认）/ 内置·本地缓存（离线、计算更快）。

## 常见问题

- **端口被占用**：后端 8765、前端 5173，可在 `backend/.env`（`GS_PORT`）与 `frontend/.env`（`VITE_DEV_PORT`）或 [config.py](backend/config.py) / [vite.config.js](frontend/vite.config.js) 中修改。
- **首次加载慢**：首次需联网获取 TLE（之后 12h 内走本地缓存）；网络不可用时可在系统配置页切换到"内置/本地缓存"模式。
- **外部浏览器打不开 localhost**：本机代理（如 Clash TUN）接管回环流量时，改用 `http://127.0.0.1:5173/` 或给代理加 localhost 直连规则。
