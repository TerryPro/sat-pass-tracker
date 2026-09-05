"""
业务编排层：参数解析 / 范围校验 / 过境计算 / 全局状态更新。

路由层（passesapi.py）只负责 HTTP 参数绑定与响应返回；
具体的业务流程——地面站预设解析、参数 clamp、TLE 获取、计算、
以及把结果写入 state._state 供 Socket.IO 实时广播——都收敛到这里，
避免路由层直接操纵其它模块的内部状态（原先散落在 passesapi._compute）。
"""

from __future__ import annotations

import threading
from dataclasses import asdict
from datetime import datetime, timezone

from config import (  # noqa: E402
    DEFAULT_ALT_M,
    DEFAULT_LAT,
    DEFAULT_LON,
    ON80DD_ALT_M,
    ON80DD_LAT,
    ON80DD_LON,
)
from astro import (  # noqa: E402
    PassesOutput,
    _time_to_dt,
    compute_groundtrack,
    compute_passes,
    passes_output_to_dict,
)
from state import _state  # noqa: E402
import tle  # noqa: E402
from tle import _get_tle_cached, _parse_tle_epoch, _resolve_satellite  # noqa: E402

# 全局实时状态写锁：请求改走线程池后，多个计算请求 / Socket.IO 广播可能并发
# 读写 state._state，用锁保证"站点配置 + 输出 + 当前卫星"作为整体原子更新，
# 避免广播读到一半更新（例如 station 是新的、output 还是旧的）。
_state_lock = threading.Lock()

MAX_HOURS = 24 * 14  # 最多 14 天
MIN_SAMPLE_SEC = 1
MAX_SAMPLE_SEC = 600
MIN_STEP_SEC = 10
MAX_STEP_SEC = 600


def _clamp(value: float, lo: float, hi: float) -> float:
    """把数值夹在 [lo, hi] 区间内，防止请求参数超出合理范围。"""
    return min(max(value, lo), hi)


def _resolve_station(params: dict) -> dict:
    """解析地面站坐标与内置预设（preset），返回 {lat, lon, alt, label}。

    坐标做范围 clamp，防止越界参数传给 skyfield 导致 500 或无效结果。
    """
    lat = _clamp(float(params.get("lat", DEFAULT_LAT)), -90.0, 90.0)
    lon = _clamp(float(params.get("lon", DEFAULT_LON)), -180.0, 180.0)
    alt = _clamp(float(params.get("alt", DEFAULT_ALT_M)), 0.0, 10000.0)
    preset = str(params.get("preset", "")).lower()
    if preset == "on80dd":
        lat, lon, alt = ON80DD_LAT, ON80DD_LON, ON80DD_ALT_M
        label = "ON80DD"
    elif preset in ("beijing", "bj"):
        lat, lon, alt = DEFAULT_LAT, DEFAULT_LON, DEFAULT_ALT_M
        label = "Beijing"
    else:
        label = f"{lat:.3f}, {lon:.3f}"
    return {"lat": lat, "lon": lon, "alt": alt, "label": label}


def _update_state(station: dict, sat_key: str, norad_id: int, hours: int,
                  sample_sec: int, horizon: float, output_dict: dict) -> None:
    """把最近一次计算写入 state._state，供 Socket.IO 实时位置广播只读使用。"""
    with _state_lock:
        _state["station"] = {
            "lat": station["lat"], "lon": station["lon"], "alt": station["alt"],
            "label": station["label"],
            "hours": hours, "sample_interval": sample_sec, "horizon": horizon,
            "satellite": sat_key, "norad_id": norad_id,
        }
        _state["output"] = output_dict
        _state["current_satellite"] = sat_key


def compute_passes_service(params: dict) -> dict:
    """过境业务编排：解析参数 → clamp 校验 → 计算 → 更新 state → 返回 dict。"""
    station = _resolve_station(params)
    hours = int(_clamp(float(params.get("hours", 48)), 1, MAX_HOURS))
    sample_sec = int(_clamp(float(params.get("sample_interval", 30)),
                            MIN_SAMPLE_SEC, MAX_SAMPLE_SEC))
    horizon = _clamp(float(params.get("horizon", 0.0)), -90.0, 90.0)
    sat_key, norad_id = _resolve_satellite(params)

    tle_name, tle1, tle2 = _get_tle_cached(norad_id)
    passes, sat = compute_passes(
        tle_name=tle_name, tle1=tle1, tle2=tle2,
        lat=station["lat"], lon=station["lon"], alt_m=station["alt"],
        hours=hours, horizon_deg=horizon, sample_interval_sec=sample_sec,
    )
    epoch_dt = _time_to_dt(sat.epoch) if sat.epoch is not None else None
    output = PassesOutput(
        satellite_name=tle_name,
        norad_id=norad_id,
        tle_name=tle_name,
        tle1=tle1,
        tle2=tle2,
        tle_epoch=epoch_dt.isoformat() if epoch_dt else "",
        station_lat=round(station["lat"], 6),
        station_lon=round(station["lon"], 6),
        station_alt_m=round(station["alt"], 2),
        station_label=station["label"],
        generated_at=datetime.now(timezone.utc).isoformat(),
        horizon_deg=horizon,
        hours=hours,
        sample_interval_sec=sample_sec,
        passes=passes,
    )
    output_dict = passes_output_to_dict(output)
    # 附加 TLE 来源标记（online / fallback / cache），供前端透明提示数据新鲜度
    output_dict["tle_source"] = tle.tle_source(norad_id)

    _update_state(station, sat_key, norad_id, hours, sample_sec, horizon, output_dict)
    return output_dict


def compute_groundtrack_service(params: dict) -> dict:
    """星下点轨迹业务编排：解析参数 → clamp 校验 → 计算 → 返回 dict。"""
    station = _resolve_station(params)
    hours = int(_clamp(float(params.get("hours", 48)), 1, MAX_HOURS))
    step_sec = int(_clamp(float(params.get("step_sec", 60)),
                          MIN_STEP_SEC, MAX_STEP_SEC))

    sat_key, norad_id = _resolve_satellite(params)
    tle_name, tle1, tle2 = _get_tle_cached(norad_id)
    points = compute_groundtrack(
        tle_name=tle_name, tle1=tle1, tle2=tle2,
        lat=station["lat"], lon=station["lon"], alt_m=station["alt"],
        hours=hours, step_sec=step_sec,
    )
    epoch_dt = _parse_tle_epoch(tle1)
    return {
        "satellite_name": tle_name,
        "norad_id": norad_id,
        "tle_epoch": epoch_dt.isoformat() if epoch_dt else "",
        "tle_source": tle.tle_source(norad_id),
        "station_label": station["label"],
        "station_lat": round(station["lat"], 6),
        "station_lon": round(station["lon"], 6),
        "station_alt_m": round(station["alt"], 2),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "hours": hours,
        "step_sec": step_sec,
        "points": [asdict(p) for p in points],
    }
