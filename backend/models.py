"""
pydantic 响应模型：为过境 / 星下点轨迹接口提供类型与 OpenAPI 文档。

字段与现有输出结构严格对齐，避免破坏前端解析。
"""

from __future__ import annotations

from pydantic import BaseModel


class AzElSampleOut(BaseModel):
    t: str          # ISO 时间 (UTC)
    az: float       # 方位角 (°)
    el: float       # 仰角 (°)
    r_km: float     # 斜距 (km)


class PassOut(BaseModel):
    index: int
    aos: str                # ISO UTC
    los: str                # ISO UTC
    duration_sec: int
    max_elevation_deg: float
    max_elevation_at: str   # ISO UTC
    aos_az: float
    los_az: float
    peak_az: float
    samples: list[AzElSampleOut]


class PassesResponse(BaseModel):
    satellite_name: str
    norad_id: int
    tle_name: str
    tle1: str
    tle2: str
    tle_epoch: str
    station_lat: float
    station_lon: float
    station_alt_m: float
    station_label: str
    generated_at: str
    horizon_deg: float
    hours: int
    sample_interval_sec: int
    tle_source: str
    passes: list[PassOut]


class GroundTrackPointOut(BaseModel):
    t: str          # ISO 时间 (UTC)
    lat: float
    lon: float
    el: float
    az: float
    r_km: float
    orbit: int
    alt_km: float


class GroundTrackResponse(BaseModel):
    satellite_name: str
    norad_id: int
    tle_epoch: str
    tle_source: str
    station_label: str
    station_lat: float
    station_lon: float
    station_alt_m: float
    generated_at: str
    hours: int
    step_sec: int
    points: list[GroundTrackPointOut]
