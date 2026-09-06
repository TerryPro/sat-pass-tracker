# 卫星过境跟踪 — Rust 后端（backend-rs）

与 `backend/`（Python + FastAPI + Skyfield）功能**完全对等**的 Rust 实现，对现有 React 前端为 **drop-in 替换**：REST 路径、JSON 字段、Socket.IO 事件全部一致，且与 Python 后端**共享同一份数据文件**（`backend/config/`、`backend/data/`）。

- Web/异步：`axum` 0.8 + `tokio`
- 实时：`socketioxide`（Socket.IO v4/v5 协议，兼容前端 `socket.io-client@4.7.5`），挂载于 `/socket.io`
- 天文计算：官方 Vallado SGP4（`sgp4` crate）+ 自建坐标转换（GMST → ECEF → SEZ）
- 持久化：JSON 文件（原子写），无数据库
- HTTP 客户端：`reqwest`

## 运行

```bash
cd backend-rs
cargo run                 # 监听 GS_HOST:GS_PORT（默认 0.0.0.0:8765）
```

前端默认代理到 `http://localhost:8765`，因此 Rust 后端监听 8765 时前端**零改动**即可对接（与 Python 后端二选一运行，避免同时写同一份数据文件）。开发期也可临时用其它端口对照：

```bash
# PowerShell
$env:GS_PORT='8799'; cargo run
# 前端指向该端口
$env:VITE_API_PROXY_TARGET='http://localhost:8799'; npm run dev
```

配置项见 [.env.example](.env.example)（与 `backend/.env.example` 键位一致）；额外支持 `GS_CONFIG_DIR` 覆盖运行时配置目录。

## 测试

```bash
cd backend-rs
cargo test                # 离线确定性单测（不联网、不污染真实数据）
```

单测覆盖：宽松 TLE 解析、坐标转换往返、GMST、过境搜索与排序、采样量保护、轨道根数解析、3LE 解析、站点/卫星规范化、卫星解析回退等。

## 精度说明

天文计算采用官方 Vallado SGP4，坐标转换用 GMST 做 TEME→ECEF（忽略章动/极移/赤道均分点改正与 ΔUT1，不做大气折射，与 Skyfield `.altaz()` 默认行为一致）。与 Python/Skyfield 交叉验证结果：

| 量 | 差异 |
| --- | --- |
| az / el | < 0.001° |
| 斜距 | < 0.1 km |
| 星下点经纬 | < 0.002° |
| 过境 AOS/LOS | < 0.2 s |

满足"物理正确"目标，前端展示与 Python 后端一致。

## 模块对应

| Rust | Python | 职责 |
| --- | --- | --- |
| `main.rs` | `app.py` | 组装路由 / CORS / Socket.IO / 启动 |
| `config.rs` | `config.py` | 环境变量 / 默认坐标 / 目录 |
| `error.rs` | `exceptions.py` | 统一错误 `{"error": ...}` |
| `models.rs` | `models.py` | 响应模型 |
| `catalog.rs` | `catalog.py` | 内置目录 / 兜底 TLE |
| `astroconv.rs` | (astro 的 Skyfield 部分) | SGP4 封装 / 坐标转换 / 时间格式 |
| `astro.rs` | `astro.py` | 过境 / 星下点 / 实时位置 |
| `passservice.rs` | `passservice.py` | 业务编排 |
| `tle.rs` | `tle.py` | TLE 三级缓存 / 解析 |
| `provider.rs` | `provider.py` | 网络数据源 |
| `store.rs` | `store.py` | JSON 持久化 |
| `libfiles.rs` | `lib.py` | CelesTrak 组下载 / 浏览 |
| `state.rs` | `state.py` | 运行时共享状态 |
| `sio.rs` | `sio.py` | Socket.IO 广播 |
| `routes/` | `settings/satellites/passesapi/library.py` | REST 路由 |

## 注意

- 同一时刻只运行一个后端（Rust 或 Python），避免并发写 `settings.json` / `tles.json` 互相覆盖。
- CPU 密集的过境/轨迹计算在 `spawn_blocking` 中执行，位置计算可能触发联网取 TLE，均不阻塞异步事件循环。
