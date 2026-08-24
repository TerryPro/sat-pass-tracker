"""
过境计算 REST 接口：/api/passes 与 /api/groundtrack。

路由层只负责 HTTP 参数绑定与响应返回；
业务编排（参数解析 / 校验 / 计算 / 状态更新）收敛到 passservice。
"""

from __future__ import annotations

from fastapi import APIRouter

from config import (  # noqa: E402
    DEFAULT_ALT_M,
    DEFAULT_LAT,
    DEFAULT_LON,
)
from models import GroundTrackResponse, PassesResponse  # noqa: E402
from passservice import (  # noqa: E402
    compute_groundtrack_service,
    compute_passes_service,
)

router = APIRouter()


@router.get("/api/passes", response_model=PassesResponse)
async def api_passes(
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
    alt: float = DEFAULT_ALT_M,
    hours: int = 48,
    sample_interval: int = 60,
    horizon: float = 0.0,
    preset: str = "",
    satellite: str = "fo29",
):
    """计算未来 N 小时指定卫星过境数据（az/el/斜距逐样本采样）。

    错误由全局异常处理器统一转换（500 → {"error": ...}）。
    """
    return compute_passes_service(
        {
            "lat": lat, "lon": lon, "alt": alt,
            "hours": hours, "sample_interval": sample_interval,
            "horizon": horizon, "preset": preset, "satellite": satellite,
        }
    )


@router.get("/api/groundtrack", response_model=GroundTrackResponse)
async def api_groundtrack(
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
    alt: float = DEFAULT_ALT_M,
    hours: int = 48,
    step_sec: int = 60,
    preset: str = "",
    satellite: str = "fo29",
):
    """计算未来 N 小时、每 step_sec 秒一个点的星下点轨迹（二维地图显示用）。"""
    return compute_groundtrack_service(
        {
            "lat": lat, "lon": lon, "alt": alt,
            "hours": hours, "step_sec": step_sec,
            "preset": preset, "satellite": satellite,
        }
    )
