"""
卫星过境跟踪 — 后端服务入口 (FastAPI + Socket.IO)

组装各功能模块：
    settings.py     用户设置路由
    satellites.py   卫星目录路由
    passesapi.py    过境 / 星下点轨迹路由
    sio.py          Socket.IO 实时位置广播
    store.py        设置 / TLE / 卫星信息持久化
    tle.py          TLE 获取策略与解析
    provider.py     网络数据源（TLE / 卫星信息 / AMSAT 频率）
    astro.py        过境 / 星下点 / 实时位置计算（Skyfield）
    passservice.py  过境业务编排（参数解析 / 校验 / 状态更新）
    state.py        运行时共享状态（站点配置 + 最新输出，sio 只读）

启动：
    cd standalone/backend
    python -m uvicorn app:sio_app --host 0.0.0.0 --port 8765
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import socketio
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import config  # noqa: E402
import library  # noqa: E402
import passesapi  # noqa: E402
import satellites  # noqa: E402
import settings  # noqa: E402
from exceptions import APIError  # noqa: E402
from logging_conf import setup_logging  # noqa: E402
from sio import _clients, position_broadcaster, sio  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动即统一前端日志格式（幂等，服务/测试均生效）
    setup_logging()
    task = asyncio.create_task(position_broadcaster())
    yield
    task.cancel()


app = FastAPI(
    title="Satellite Pass Tracking Backend",
    version=config.APP_VERSION,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=config.CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------
# 全局异常处理：路由层只负责 raise，由这里统一转换为 {"error": ...} 响应
# ---------------------------------------------------------------
@app.exception_handler(APIError)
async def api_error_handler(request: Request, exc: APIError):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    # 兜底：未预期异常统一 500（与原各 handler 的 try/except 行为一致）。
    # 详情（含堆栈）记入服务端日志，不把内部实现细节暴露给客户端。
    logging.getLogger("app").exception("未处理异常: %s %s", request.method, request.url.path)
    return JSONResponse({"error": "服务器内部错误"}, status_code=500)


app.include_router(settings.router)
app.include_router(satellites.router)
app.include_router(passesapi.router)
app.include_router(library.router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "sat-pass-tracker",
        "version": config.APP_VERSION,
        "clients": len(_clients),
    }


# ---------------------------------------------------------------
# 打包 ASGI 应用：Socket.IO 优先，其余走 FastAPI
# ---------------------------------------------------------------
sio_app = socketio.ASGIApp(sio, other_asgi_app=app)


if __name__ == "__main__":
    # 监听地址/端口可在 backend/.env 或环境变量中配置（GS_HOST / GS_PORT）
    uvicorn.run(sio_app, host=config.HOST, port=config.PORT)
