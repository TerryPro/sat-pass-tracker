"""
应用运行时状态：最近一次计算得到的站点配置 + 过境结果。

由业务层（passservice）写入，Socket.IO（sio.py）与健康检查只读。
集中在一处，避免路由层直接操纵其它模块的内部变量（原先散布在 sio._state）。
"""

from __future__ import annotations

# 站点配置 + 当前输出（供 Socket.IO 实时位置广播使用）
_state: dict = {
    "station": None,      # { lat, lon, alt, label, hours, sample_interval, horizon, satellite, norad_id }
    "output": None,       # PassesOutput dict
    "current_satellite": None,
}
