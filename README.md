# 卫星过境跟踪（standalone）

卫星过境跟踪 —— 面向业余无线电卫星（FO-29 / ISS / 中国空间站等）的过境预测与跟踪 Web 应用。

- **后端**：Python + FastAPI + Socket.IO（端口 `8765`），基于 Skyfield/SGP4 计算过境
- **前端**：React + Vite + MUI + ECharts + OpenLayers + Cesium（端口 `5173`，开发时代理 `/api` 与 `/socket.io` 到后端）

## 目录结构

```
├── backend/                 # FastAPI + Socket.IO 后端
│   ├── app.py               # 入口：组装各模块、CORS、health、ASGI 打包
│   ├── settings.py          # 用户设置路由
│   ├── satellites.py        # 卫星目录路由（搜索/导入/删除/详情/刷新）
│   ├── passesapi.py         # 过境 / 星下点轨迹路由
│   ├── sio.py               # Socket.IO 实时位置广播
│   ├── store.py             # 持久化层（设置 / TLE / 卫星信息文件读写）
│   ├── tle.py               # TLE 获取策略与解析
│   ├── passes.py            # 过境计算（Skyfield）
│   ├── config.py            # 环境变量 / .env 配置
│   ├── requirements.txt     # Python 依赖
│   └── data/                # 运行时数据（不入库）：settings.json / tles.json / satellite_info.json
├── frontend/                # React + Vite 前端
│   └── src/
│       ├── api.js           # REST + Socket.IO 客户端
│       ├── slices/          # Redux（track / settings）
│       ├── pages/           # TrackPage（轨迹页）、SettingsPage（设置页）
│       └── components/      # 控制栏、过境列表、极坐标图、2D/3D 地图等
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

端口、默认坐标等硬编码已抽离为环境变量，复制模板并按需修改（`.env` 不入库，`.env.example` 为模板）：

```bash
cp backend/.env.example  backend/.env      # 后端：GS_HOST / GS_PORT / GS_DEFAULT_* / GS_DATA_DIR
cp frontend/.env.example frontend/.env     # 前端：VITE_DEV_PORT / VITE_API_PROXY_TARGET / VITE_DEFAULT_*
```

- 后端：真实环境变量优先于 `.env` 文件，全部可省略（省略用代码内默认值）；`.env` 改动需重启后端。
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

说明：后端测试使用内置历史 TLE（离线、确定性），并把设置/TLE 数据文件重定向到临时目录，不会污染真实运行时数据；前端测试覆盖 `chartUtils` 极坐标映射与 `trackSlice` 状态切片。

## 功能一览

- **过境预测**：未来 1~336 小时的过境列表（AOS/LOS、时长、最大仰角、逐样本方位/仰角/斜距），支持任意 NORAD 目录号卫星
- **实时跟踪**：Socket.IO 每 2s 推送卫星当前 az/el/斜距/星下点
- **2D 地图**（OpenLayers）：星下点轨迹、晨昏线（夜影阴影 + 可关闭的橘色虚线分界）、地面站可视范围、经纬网、多投影（EPSG:4326/3857）
- **3D 地球**（Cesium）：空间轨道线 + 地表轨迹双线渲染、地面站通视圆、惯性系（ICRF）/ 地固系切换、选中过境高亮
- **推演回放**：时间轴播放（30×~720× 倍速）、时间-仰角甘特图
- **极坐标图**（ECharts）：AOS/Peak/LOS 标注 + 实时当前位置，采样点明细表
- **卫星管理**：按名称/NORAD 目录号搜索导入（SatNOGS/CelesTrak 在线 TLE），手动/批量刷新轨道，卫星详情（轨道根数、业余无线电频率、SatNOGS 元数据）
- **设置持久化**：地面站（内置 ON80DD/北京 + 自定义）、默认卫星、时长/采样间隔、主题（暗/亮）、晨昏线虚线开关 —— 保存到 `backend/data/settings.json`，重启保留

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

### Socket.IO 事件

| 事件 | 方向 | 数据 |
| --- | --- | --- |
| `connect` | 客户端→服务端 | 服务端立即回发 `state` |
| `state` | 服务端→客户端 | `{ station, position }` 当前站点配置 + 最新位置 |
| `satellite:position` | 服务端→客户端 | 每 2s 广播 `{ t, az, el, r_km, lat, lon, alt_km }` |

## 数据与缓存

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 用户设置 | `backend/data/settings.json` | 坐标/卫星/时长/主题/晨昏线开关等 |
| TLE 缓存 | `backend/data/tles.json` | 内存 1h + 文件 12h 有效，过期才联网更新 |
| 卫星信息缓存 | `backend/data/satellite_info.json` | SatNOGS 元数据 30 天有效 |
| AMSAT 频率 | 内存 | 24h 过期重新拉取 |

TLE 在线源：SatNOGS → CelesTrak；全部失败时回退到内置历史 TLE（`passes.py` 中硬编码）。内置卫星：FO-29 (24278)、ISS (25544)、中国空间站 (48274)。

## 常见问题

- **端口被占用**：后端 8765、前端 5173，可在 `app.py` 与 `vite.config.js` 中修改。
- **首次加载慢**：首次需联网获取 TLE（之后 12h 内走本地缓存）。
