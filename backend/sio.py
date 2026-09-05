"""
Socket.IO 服务：连接即回发当前站点配置与最新位置；每 2s 广播卫星当前 az/el。

实时广播状态（state._state）由业务层写入，本模块只读使用。
"""

from __future__ import annotations

import asyncio
import config

from concurrent.futures import ThreadPoolExecutor

import socketio

from astro import compute_current_position  # noqa: E402
from state import _state  # noqa: E402
from tle import _get_tle_cached, _resolve_satellite  # noqa: E402

# 在线 Socket.IO 客户端
_clients: set = set()

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=config.CORS_ORIGINS,
    cors_credentials=config.CORS_ALLOW_CREDENTIALS,
)

# 实时位置专用线程池（max_workers=1）：connect 回发与周期性广播共用。
# 位置计算可能触发 TLE 联网（最坏数十秒），不能阻塞 asyncio 事件循环；
# 若此时又有并发 connect，会排队在其后，但绝不会卡死心跳/其它请求。
_position_executor = ThreadPoolExecutor(1)


@sio.event
async def connect(sid, environ, auth=None):
    _clients.add(sid)
    # 连接即回发当前站点配置与最新位置。
    # 站点读取 + 位置计算（可能触发 TLE 联网）都放到专用线程池执行，
    # 保证两者同源且不阻塞 asyncio 事件循环。
    loop = asyncio.get_running_loop()
    station, position = await loop.run_in_executor(_position_executor, _snapshot)
    await sio.emit(
        "state",
        {"station": station, "position": position},
        to=sid,
    )


@sio.event
async def disconnect(sid):
    _clients.discard(sid)


def _current_position():
    """（同步）计算卫星当前 az/el 等。仅应在后台线程执行，可能触发 TLE 联网。"""
    st = _state
    station = st.get("station")
    if not station:
        return None
    sat_key = station.get("satellite", "iss")
    _, norad_id = _resolve_satellite({"satellite": sat_key})
    try:
        tle = _get_tle_cached(norad_id)
    except Exception:
        # TLE 获取失败（如联网失败且无本地数据）时不广播，不打断连接
        return None
    if not tle:
        return None
    name, tle1, tle2 = tle
    s = station
    return compute_current_position(tle1, tle2, s["lat"], s["lon"], s["alt"])


def _snapshot():
    """（同步，后台线程执行）返回 (station 快照, position)，两者来自同一时刻的状态。"""
    station = _state["station"]
    position = _current_position()
    return station, position


async def _async_position():
    """把同步位置计算丢到专用线程池，避免阻塞 asyncio 事件循环。

    返回 position；无站点配置或计算失败时为 None。
    """
    loop = asyncio.get_running_loop()
    station, position = await loop.run_in_executor(_position_executor, _snapshot)
    del station  # station 仅用于保证与 position 同源，此处丢弃
    return position


async def position_broadcaster():
    """每 2s 广播一次卫星当前 az/el（仅当存在站点配置与客户端连接时）。"""
    while True:
        await asyncio.sleep(2)
        if not _clients:
            continue
        pos = await _async_position()
        if pos:
            await sio.emit("satellite:position", pos)
