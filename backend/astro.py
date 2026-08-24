"""
纯计算层：卫星过境 / 星下点轨迹 / 实时位置计算（Skyfield）。

不包含网络 IO、文件 IO、业务编排与全局可变应用状态 ——
输入 TLE 与站点参数，输出计算结果。数据模型与数据量保护也集中在此，
供上层（passservice / sio / 测试）复用。站点坐标由调用方传入。
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

import numpy as np
from skyfield.api import EarthSatellite, Topos, load, wgs84
from skyfield.timelib import Time

# ON80DD 格网坐标 (Maidenhead locator) 与北京默认坐标来源说明：
#   Maidenhead 6 字符解码：
#   O(14)→ -180+14×20=100°E  N(13)→ -90+13×10=40°N
#   8→+16°=116°E  0→+0°=40°N
#   d(3)→+3×5'=0.25°E  d(3)→+3×2.5'=0.125°N  为格网西南角
#   格网大小 5'×2.5'，中心点约为 40.1458N / 116.2917E（北京西北，昌平/延庆一带）
# 上述坐标的默认值定义在 config.py，站点解析在 passservice._resolve_station。

# -------------------------------
# 全局缓存：避免每 2s 实时广播时重复构建昂贵的 skyfield Timescale / EarthSatellite。
# 以 TLE 组合为 key，TLE 更新后 key 变化会自动重建，无需手动失效。
# -------------------------------
_timescale = None
_satellite_model_cache: dict = {}


def _get_timescale():
    global _timescale
    if _timescale is None:
        _timescale = load.timescale()
    return _timescale


def _get_satellite_model(tle1: str, tle2: str, tle_name: str = "FO-29"):
    """按 TLE 组合缓存 EarthSatellite 模型；TLE 变化时自动重建。"""
    key = (tle1, tle2)
    sat = _satellite_model_cache.get(key)
    if sat is None:
        sat = EarthSatellite(tle1, tle2, tle_name, _get_timescale())
        _satellite_model_cache[key] = sat
    return sat


# ---------- 输出数据结构 ----------
@dataclass
class AzElSample:
    t: str          # ISO 时间 (UTC)
    az: float       # 方位角 (°)
    el: float       # 俯仰角 (°)
    r_km: float     # 斜距 (km)


@dataclass
class Pass:
    index: int
    aos: str                # ISO UTC
    los: str                # ISO UTC
    duration_sec: int
    max_elevation_deg: float
    max_elevation_at: str   # ISO UTC
    aos_az: float           # AOS 时的方位角
    los_az: float           # LOS 时的方位角
    peak_az: float          # 最高点方位角
    samples: List[AzElSample] = field(default_factory=list)


@dataclass
class PassesOutput:
    satellite_name: str
    norad_id: int
    tle_name: str
    tle1: str
    tle2: str
    tle_epoch: str          # TLE 历元 ISO
    station_lat: float
    station_lon: float
    station_alt_m: float
    station_label: str
    generated_at: str       # 生成时间 ISO (UTC)
    horizon_deg: float
    hours: int
    sample_interval_sec: int
    passes: List[Pass]


def passes_output_to_dict(output: PassesOutput) -> dict:
    """PassesOutput → dict（JSON 序列化用）。"""
    return asdict(output)


@dataclass
class GroundTrackPoint:
    t: str          # ISO 时间 (UTC)
    lat: float      # 星下点纬度 (°)
    lon: float      # 星下点经度 (°)
    el: float       # 地面站视角仰角 (°)
    az: float       # 地面站视角方位角 (°)
    r_km: float     # 斜距 (km)
    orbit: int      # 轨道圈号（从 1 起）
    alt_km: float   # 卫星相对 WGS84 椭球的高度 (km)，3D 地球视图定位用


# ---------- 时间工具：Python datetime (UTC) 与 skyfield Time 互转 ----------
def _ts_from_dt(ts, dt: datetime):
    """Python datetime (UTC aware) → skyfield Time."""
    return ts.from_datetime(dt)


def _ts_from_dt_arr(ts, dts):
    """List/array of Python datetime → skyfield Time."""
    try:
        return ts.from_datetimes(list(dts))
    except Exception:
        # from_datetimes 不可用时，对每一项转换
        return ts.from_datetime(list(dts))


def _time_to_dt(t):
    """skyfield Time → Python UTC aware datetime."""
    return t.utc_datetime() if hasattr(t, "utc_datetime") else t.astimezone(timezone.utc)


# ---------------------------------------------------------------
# 数据量保护：防止"长过境（GEO/IGSO）+ 小采样间隔 + 长时段"产生海量数据
# （百万级采样点会让 JSON 响应膨胀到上百 MB，卡死浏览器）
# ---------------------------------------------------------------
MAX_SAMPLES_PER_PASS = 5000   # 单次过境最大采样点数（超限自动放大采样间隔）
MAX_TOTAL_SAMPLES = 150_000   # 单次请求累计采样点上限（超限报错，提示调整参数）
MAX_GROUNDTRACK_POINTS = 20_000  # 星下点轨迹最大点数（超限自动放大步长）


def _sampling_plan(duration_sec: int, requested_sec: int, max_samples: int = MAX_SAMPLES_PER_PASS) -> Tuple[int, int]:
    """按过境时长与请求间隔计算采样计划 (点数, 实际间隔秒)。

    请求间隔过密（时长÷间隔 > max_samples）时自动放大间隔，
    保证样本均匀覆盖全程且数量不超过上限；常规场景返回原计划。
    """
    n = max(2, duration_sec // requested_sec)
    if n <= max_samples:
        return n, requested_sec
    step = requested_sec * ((n + max_samples - 1) // max_samples)
    return max(2, duration_sec // step), step


# ---------- 过境计算 ----------
def _find_next_rise(
    ts, sat: EarthSatellite, topos: Topos, t0: Time, t_end: Time, horizon_deg: float
) -> Optional[Time]:
    """从 t0 起找到下一个仰角上升穿越 horizon_deg 的时刻（大步粗搜扫到窗口末尾）。

    粗搜步长 10 分钟，对 LEO（分钟级）与 IGSO/GEO（小时级升降）均适用。
    """
    step = timedelta(minutes=10)
    span = (_time_to_dt(t_end) - _time_to_dt(t0)).total_seconds()
    steps = int(span / step.total_seconds()) + 2

    prev = t0
    prev_el = (sat - topos).at(prev).altaz()[0].degrees
    t_low = t_high = None
    for _ in range(steps):
        probe_dt = _time_to_dt(prev) + step
        if probe_dt >= _time_to_dt(t_end):
            break
        probe = _ts_from_dt(ts, probe_dt)
        probe_el = (sat - topos).at(probe).altaz()[0].degrees
        # 找到上升穿越对：前一时刻在地平线下，后一时刻在地平线上
        if prev_el < horizon_deg <= probe_el:
            t_low, t_high = prev, probe
            break
        prev, prev_el = probe, probe_el
    if t_low is None or t_high is None:
        return None

    # 二分查找穿越点
    for _ in range(60):
        mid_dt = _time_to_dt(t_low) + (_time_to_dt(t_high) - _time_to_dt(t_low)) / 2
        mid = _ts_from_dt(ts, mid_dt)
        el_mid = (sat - topos).at(mid).altaz()[0].degrees
        if el_mid < horizon_deg:
            t_low = mid
        else:
            t_high = mid
    return t_high


def _find_next_set(
    ts, sat: EarthSatellite, topos: Topos, t0: Time, t_end: Time, horizon_deg: float
) -> Optional[Time]:
    """从 t0 (已在地平线上) 起找到下一个仰角下降穿越 horizon_deg 的时刻（扫到窗口末尾）。

    粗搜步长 15 分钟：LEO 数分钟即可定位，IGSO/GEO 跨数十小时的下降也能找到。
    """
    step = timedelta(minutes=15)
    span = (_time_to_dt(t_end) - _time_to_dt(t0)).total_seconds()
    steps = int(span / step.total_seconds()) + 2

    prev = t0
    prev_el = (sat - topos).at(prev).altaz()[0].degrees
    t_low = t_high = None
    for _ in range(steps):
        probe_dt = _time_to_dt(prev) + step
        if probe_dt >= _time_to_dt(t_end):
            break
        probe = _ts_from_dt(ts, probe_dt)
        probe_el = (sat - topos).at(probe).altaz()[0].degrees
        # 找到下降穿越对：前一时刻在地平线上，后一时刻在地平线下
        if prev_el >= horizon_deg > probe_el:
            t_low, t_high = prev, probe
            break
        prev, prev_el = probe, probe_el
    if t_low is None or t_high is None:
        return None

    # 二分查找穿越点
    for _ in range(60):
        mid_dt = _time_to_dt(t_low) + (_time_to_dt(t_high) - _time_to_dt(t_low)) / 2
        mid = _ts_from_dt(ts, mid_dt)
        el_mid = (sat - topos).at(mid).altaz()[0].degrees
        if el_mid >= horizon_deg:
            t_low = mid
        else:
            t_high = mid
    return t_high


def compute_passes(
    tle_name: str,
    tle1: str,
    tle2: str,
    lat: float,
    lon: float,
    alt_m: float,
    hours: int,
    horizon_deg: float,
    sample_interval_sec: int,
) -> Tuple[List[Pass], EarthSatellite]:
    """计算未来 hours 小时内的所有过境，返回 (passes, satellite)。"""
    ts = load.timescale()
    sat = EarthSatellite(tle1, tle2, tle_name, ts)
    topos = wgs84.latlon(lat, lon, elevation_m=alt_m)

    now = datetime.now(timezone.utc)
    t_start = _ts_from_dt(ts, now)
    t_end = _ts_from_dt(ts, now + timedelta(hours=hours))

    passes: List[Pass] = []
    t_cursor = t_start
    idx = 0
    total_samples = 0  # 累计采样点（全局数据量保护）

    while True:
        # 若当前时刻已在地平线上（高轨/静止卫星可能长时间持续可见），
        # 视为"进行中的过境"，起点取当前时刻；否则寻找下一次上升穿越
        cur_el = float((sat - topos).at(t_cursor).altaz()[0].degrees)
        if cur_el > horizon_deg:
            t_rise = t_cursor
        else:
            t_rise = _find_next_rise(ts, sat, topos, t_cursor, t_end, horizon_deg)
            if t_rise is None:
                break

        t_set = _find_next_set(ts, sat, topos, t_rise, t_end, horizon_deg)
        if t_set is None:
            t_set = t_end  # 窗口结束时仍在可见范围内 → 以窗口末尾为 LOS

        aos_dt = _time_to_dt(t_rise)
        los_dt = _time_to_dt(t_set)
        duration = int((los_dt - aos_dt).total_seconds())

        # 采样计划：过境过长 + 间隔过密时自动放大间隔，控制单次过境数据量
        n, step_sec = _sampling_plan(duration, sample_interval_sec)
        sample_times_dt = [
            aos_dt + timedelta(seconds=i * step_sec)
            for i in range(n)
        ]
        # 确保 LOS 也采样一次
        if sample_times_dt[-1] < los_dt:
            sample_times_dt.append(los_dt)
        sample_times: Time = _ts_from_dt_arr(ts, sample_times_dt)

        diff = sat - topos
        pos = diff.at(sample_times)
        altaz = pos.altaz()
        els = altaz[0].degrees
        azs = altaz[1].degrees
        r_km_vals = pos.distance().km

        samples: List[AzElSample] = []
        peak_el = -999.0
        peak_at = aos_dt
        peak_az = 0.0
        aos_az = float(azs[0])
        los_az = float(azs[-1])

        for dt_s, el, az, rk in zip(sample_times_dt, els, azs, r_km_vals):
            el_f = float(el)
            az_f = float(az)
            rk_f = float(rk)
            samples.append(
                AzElSample(
                    t=dt_s.isoformat(),
                    az=round(az_f, 3),
                    el=round(el_f, 3),
                    r_km=round(rk_f, 2),
                )
            )
            if el_f > peak_el:
                peak_el = el_f
                peak_at = dt_s
                peak_az = az_f

        idx += 1
        # 全局数据量保护：累计采样点超上限时报错（避免超大 JSON 响应卡死前端）
        total_samples += len(samples)
        if total_samples > MAX_TOTAL_SAMPLES:
            raise ValueError(
                f"采样数据量过大（累计 {total_samples} 点），"
                "请增大采样间隔或缩短显示时长"
            )
        passes.append(
            Pass(
                index=idx,
                aos=aos_dt.isoformat(),
                los=los_dt.isoformat(),
                duration_sec=duration,
                max_elevation_deg=round(float(peak_el), 2),
                max_elevation_at=peak_at.isoformat(),
                aos_az=round(float(aos_az), 2),
                los_az=round(float(los_az), 2),
                peak_az=round(float(peak_az), 2),
                samples=samples,
            )
        )

        # 下次搜索从 LOS + 小偏移开始，避免重复
        next_dt = los_dt + timedelta(seconds=10)
        t_cursor = _ts_from_dt(ts, next_dt)
        if not (t_cursor.tt < t_end.tt):
            break

    return passes, sat


def compute_current_position(
    tle1: str,
    tle2: str,
    lat: float,
    lon: float,
    alt_m: float,
) -> Optional[dict]:
    """
    计算当前时刻卫星相对地面站的 az/el/斜距（Socket.IO 实时广播用）。

    返回 dict：{ t, az, el, r_km, lat, lon }；计算失败返回 None。
    """
    try:
        ts = _get_timescale()
        sat = _get_satellite_model(tle1, tle2, "FO-29")
        topos = wgs84.latlon(lat, lon, elevation_m=alt_m)
        now = datetime.now(timezone.utc)
        t = _ts_from_dt(ts, now)
        # altaz() 返回 (仰角, 方位角, 距离) 三元组
        alt, az, dist = (sat - topos).at(t).altaz()
        # NaN 防护：无效 TLE 会产生 NaN 结果，返回 None 而不是污染前端数据
        if (
            math.isnan(float(az.degrees))
            or math.isnan(float(alt.degrees))
            or math.isnan(float(dist.km))
        ):
            return None
        # 星下点（卫星在地球表面投影，供二维地图显示）
        sub = sat.at(t).subpoint()
        return {
            "t": now.isoformat(),
            "az": round(float(az.degrees), 3),
            "el": round(float(alt.degrees), 3),
            "r_km": round(float(dist.km), 2),
            "lat": round(float(sub.latitude.degrees), 5),
            "lon": round(float(sub.longitude.degrees), 5),
            "alt_km": round(float(sub.elevation.km), 3),  # 3D 地球视图实时定位用
        }
    except Exception:
        return None


def compute_groundtrack(
    tle_name: str,
    tle1: str,
    tle2: str,
    lat: float,
    lon: float,
    alt_m: float,
    hours: int,
    step_sec: int,
) -> List[GroundTrackPoint]:
    """
    计算未来 hours 小时、每 step_sec 秒一个点的星下点轨迹（完整轨道显示用）。

    每个点包含：星下点经纬度、地面站视角 az/el、斜距，以及按经度跳变分组的圈号。
    """
    ts = load.timescale()
    sat = EarthSatellite(tle1, tle2, tle_name, ts)
    topos = wgs84.latlon(lat, lon, elevation_m=alt_m)

    now = datetime.now(timezone.utc)
    n = max(2, hours * 3600 // step_sec + 1)
    # 数据量保护：点数超上限时自动放大步长，避免超大轨迹响应
    if n > MAX_GROUNDTRACK_POINTS:
        step_sec = max(
            step_sec, math.ceil(hours * 3600 / MAX_GROUNDTRACK_POINTS)
        )
        n = max(2, hours * 3600 // step_sec + 1)
    times_dt = [now + timedelta(seconds=i * step_sec) for i in range(n)]
    t_arr = _ts_from_dt_arr(ts, times_dt)

    # 星下点（subpoint）与地面站相对几何
    diff = sat - topos
    geo = sat.at(t_arr)
    sub = geo.subpoint()
    lats = sub.latitude.degrees
    lons = sub.longitude.degrees
    alts_km = sub.elevation.km  # 卫星相对 WGS84 椭球高度，3D 视图定位用
    els = diff.at(t_arr).altaz()[0].degrees
    azs = diff.at(t_arr).altaz()[1].degrees
    r_km_vals = diff.at(t_arr).distance().km

    points: List[GroundTrackPoint] = []
    orbit = 1
    prev_lon = None
    for i, (dt_s, la, lo, ak, el, az, rk) in enumerate(
        zip(times_dt, lats, lons, alts_km, els, azs, r_km_vals)
    ):
        # 经度从 -180 → +180（或反向）跳变视为进入下一圈
        if prev_lon is not None and abs(float(lo) - prev_lon) > 180:
            orbit += 1
        prev_lon = float(lo)
        points.append(
            GroundTrackPoint(
                t=dt_s.isoformat(),
                lat=round(float(la), 5),
                lon=round(float(lo), 5),
                el=round(float(el), 3),
                az=round(float(az), 3),
                r_km=round(float(rk), 2),
                orbit=orbit,
                alt_km=round(float(ak), 3),
            )
        )
    return points
