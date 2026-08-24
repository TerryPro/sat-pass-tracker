"""
Socket.IO 服务：连接即回发当前站点配置与最新位置；每 2s 广播卫星当前 az/el。

实时广播状态（state._state）由业务层写入，本模块只读使用。
"""

from __future__ import annotations

import asyncio

import socketio

from astro import compute_current_position  # noqa: E402
from state import _state  # noqa: E402
from tle import _get_tle_cached, _resolve_satellite  # noqa: E402

# 在线 Socket.IO 客户端
_clients: set = set()

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")


@sio.event
async def connect(sid, environ, auth=None):
    _clients.add(sid)
    # 连接即回发当前站点配置与最新位置
    await sio.emit(
        "state",
        {
            "station": _state["station"],
            "position": _current_position(),
        },
        to=sid,
    )


@sio.event
async def disconnect(sid):
    _clients.discard(sid)


def _current_position():
    st = _state
    station = st.get("station")
    if not station:
        return None
    sat_key = station.get("satellite", "fo29")
    _, norad_id = _resolve_satellite({"satellite": sat_key})
    tle = _get_tle_cached(norad_id)
    if not tle:
        return None
    name, tle1, tle2 = tle
    s = station
    return compute_current_position(tle1, tle2, s["lat"], s["lon"], s["alt"])


async def position_broadcaster():
    """每 2s 广播一次卫星当前 az/el（仅当存在站点配置与客户端连接时）。"""
    while True:
        await asyncio.sleep(2)
        if not _clients:
            continue
        pos = _current_position()
        if pos:
            await sio.emit("satellite:position", pos)
