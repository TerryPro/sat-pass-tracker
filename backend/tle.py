"""
TLE 管理：在线获取策略（内存缓存 1h → 本地持久化 12h → 联网更新落盘）、
卫星参数解析、TLE 历元/轨道根数解析、名称清理。
"""

from __future__ import annotations

import math
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Tuple

from provider import fetch_latest_tle, get_builtin_tle  # noqa: E402
from store import _load_satellites, _load_settings, _load_tles, _save_tle  # noqa: E402

_TLE_CACHE_TTL = 3600.0  # 内存 TLE 缓存 1 小时（避免短时间重复请求）
_TLE_VALID_SECONDS = 12 * 3600.0  # 持久化 TLE 有效期 12 小时，过期才联网更新
_INFO_VALID_SECONDS = 30 * 24 * 3600.0  # 卫星介绍/频率缓存有效期 30 天（信息不常变）

# 内存 TLE 缓存：{ "tle_<norad>": (name, tle1, tle2), "tle_fetched_at_<norad>": ts }
_tle_cache: dict = {}
# TLE 来源记录：{ norad_id: "online" | "fallback" | "cache" }（供响应中透明提示）
_tle_source: dict = {}
# 每颗卫星的联网更新锁：请求改走线程池后可多线程并发进入 _get_tle_cached，
# 用锁保证同一 NORAD 只发生一次真实网络拉取（其余线程复用结果）。
_tle_fetch_locks: dict = {}
_tle_fetch_locks_guard = threading.Lock()


def _tle_fetch_lock(norad_id: int) -> threading.Lock:
    """返回指定卫星的 per-NORAD 联网锁（惰性创建，线程安全）。"""
    with _tle_fetch_locks_guard:
        lock = _tle_fetch_locks.get(norad_id)
        if lock is None:
            lock = threading.Lock()
            _tle_fetch_locks[norad_id] = lock
        return lock


def tle_cache_set(
    norad_id: int,
    name: str,
    tle1: str,
    tle2: str,
    fetched_ts: float,
    source: str = "online",
) -> None:
    """写入内存 TLE 缓存（供手动刷新后同步，避免短时间重复下载）。"""
    _tle_cache[f"tle_{norad_id}"] = (name, tle1, tle2)
    _tle_cache[f"tle_fetched_at_{norad_id}"] = fetched_ts
    _tle_source[norad_id] = source


def tle_source(norad_id: int) -> str:
    """返回指定卫星 TLE 的来源：online（联网最新）/ fallback（内置历史兜底）/ cache（本地缓存）。

    内存未命中时回读持久化文件（含重启场景）；旧数据无 source 字段视为 cache。
    """
    if norad_id in _tle_source:
        return _tle_source[norad_id]
    saved = _load_tles().get(str(norad_id))
    if saved:
        src = str(saved.get("source", "cache"))
        _tle_source[norad_id] = src
        return src
    return "cache"


def _clean_sat_name(name: str) -> str:
    """清理 TLE 名称行可能带的前导编号（如 "0 NOAA 19" → "NOAA 19"）。"""
    parts = name.strip().split(" ", 1)
    if len(parts) == 2 and parts[0].isdigit():
        return parts[1]
    return name.strip()


def _get_tle_cached(norad_id: int = 24278):
    """TLE 获取策略：内存缓存(1h) → 本地持久化(12h 有效) → 联网更新并落盘。

    返回 (name, tle1, tle2)。联网成功后写入 tles.json，重启后不再重复下载。
    tle_mode=builtin（离线模式，设置页可切换）时跳过联网：直接用本地持久化
    （不限新鲜度）或内置历史 TLE；仅当两者都无数据（用户导入的非内置卫星）才联网兜底。
    """
    now = time.time()
    key = f"tle_{norad_id}"
    fetched_key = f"tle_fetched_at_{norad_id}"
    # 1) 内存缓存：1 小时内直接复用
    if _tle_cache.get(key) and (now - _tle_cache.get(fetched_key, 0)) < _TLE_CACHE_TTL:
        return _tle_cache[key]
    # 2) 本地持久化：12 小时内有效，直接复用（不联网）；来源随文件记录
    saved = _load_tles().get(str(norad_id))
    if saved and (now - float(saved.get("fetched_ts", 0))) < _TLE_VALID_SECONDS:
        _tle_cache[key] = (saved["name"], saved["tle1"], saved["tle2"])
        _tle_cache[fetched_key] = float(saved.get("fetched_ts", now))
        _tle_source[norad_id] = str(saved.get("source", "cache"))
        return _tle_cache[key]
    # 3) 获取最新 TLE，写入内存 + 持久化；在线失败用历史兜底并如实记录来源。
    #    用 per-NORAD 锁串行化这一段的网络拉取；持有锁后会做一次二次检查，
    #    避免并发请求对同一卫星重复联网（也避免多次写盘）。
    with _tle_fetch_lock(norad_id):
        if _tle_cache.get(key) and (now - _tle_cache.get(fetched_key, 0)) < _TLE_CACHE_TTL:
            return _tle_cache[key]
        # 离线模式：不主动联网，用本地缓存（不限新鲜度）或内置历史 TLE
        if _load_settings().get("tle_mode") == "builtin":
            saved = _load_tles().get(str(norad_id))
            if saved:
                name, tle1, tle2 = saved["name"], saved["tle1"], saved["tle2"]
                _tle_source[norad_id] = str(saved.get("source", "cache"))
            else:
                builtin = get_builtin_tle(norad_id)
                if builtin:
                    name, tle1, tle2 = builtin
                    _tle_source[norad_id] = "builtin"
                else:
                    # 本地与内置都没有（用户导入的非内置卫星）：联网兜底一次
                    name, tle1, tle2, is_fallback = fetch_latest_tle(norad_id=norad_id)
                    _tle_source[norad_id] = "fallback" if is_fallback else "online"
            _tle_cache[key] = (name, tle1, tle2)
            _tle_cache[fetched_key] = now
            _save_tle(
                norad_id,
                _clean_sat_name(name),
                tle1,
                tle2,
                now,
                source=_tle_source[norad_id],
            )
            return _tle_cache[key]
        name, tle1, tle2, is_fallback = fetch_latest_tle(norad_id=norad_id)
        _tle_cache[key] = (name, tle1, tle2)
        _tle_cache[fetched_key] = now
        _tle_source[norad_id] = "fallback" if is_fallback else "online"
        _save_tle(
            norad_id,
            _clean_sat_name(name),
            tle1,
            tle2,
            now,
            source=_tle_source[norad_id],
        )
        return _tle_cache[key]


def _resolve_satellite(params: dict) -> Tuple[str, int]:
    """解析卫星参数，返回 (id, norad_id)。

    支持内置 key（fo29/iss/css）或任意 NORAD 目录号（数字字符串），
    从持久化的卫星列表中查找；未知则回退到 FO-29。
    """
    sat = str(params.get("satellite", "fo29")).lower()
    sats = _load_satellites()
    for s in sats:
        if s["id"] == sat or str(s["norad_id"]) == sat:
            return s["id"], int(s["norad_id"])
    try:
        nid = int(sat)
        for s in sats:
            if int(s["norad_id"]) == nid:
                return s["id"], nid
    except ValueError:
        pass
    return "fo29", 24278


def _parse_tle_epoch(tle1: str):
    """从 TLE 第一行的历元字段 (YYDDD.DDDDDDDD, 字符 19-32) 解析为 UTC datetime。"""
    if not tle1 or len(tle1) < 33:
        return None
    try:
        yy = int(tle1[18:20])
        ddd = float(tle1[20:32])
    except ValueError:
        return None
    year = 2000 + yy if yy < 57 else 1900 + yy  # 57 及以上视为 19xx
    return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=ddd - 1)


def _parse_tle_fields(tle1: str, tle2: str) -> dict:
    """从 TLE 两行解析轨道根数 + 推算国际编号/轨道分类/近远地点高度。

    解析失败返回空字典。
    """
    try:
        epoch_dt = _parse_tle_epoch(tle1)
        mean_motion = float(tle2[52:63])  # 平均运动（圈/天）
        period_min = 1440.0 / mean_motion
        inclination = float(tle2[8:16])
        eccentricity = float("0." + tle2[26:33].strip())
        # 半长轴：由平均运动按开普勒第三定律反算
        mu = 398600.4418  # 地球引力常数 km³/s²
        n_rad_s = mean_motion * 2.0 * math.pi / 86400.0
        a_km = (mu / n_rad_s**2) ** (1.0 / 3.0)
        r_earth = 6371.0
        perigee_km = a_km * (1 - eccentricity) - r_earth
        apogee_km = a_km * (1 + eccentricity) - r_earth
        # 轨道分类：按周期 + 倾角 + 偏心率
        if period_min < 128:
            orbit_class = "SSO（太阳同步轨道）" if 95 <= inclination <= 105 else "LEO（低地球轨道）"
        elif period_min < 600:
            orbit_class = "MEO（中地球轨道）"
        elif 1300 <= period_min <= 1500:
            orbit_class = "IGSO（倾斜地球同步轨道）" if inclination > 10 else "GEO（地球静止轨道）"
        else:
            orbit_class = "HEO（高椭圆轨道）" if eccentricity > 0.2 else "高地球轨道"
        return {
            "cospar": (tle1[8:17].strip() if tle1 and len(tle1) >= 17 else ""),
            "orbit_class": orbit_class,
            "perigee_km": round(perigee_km, 1),
            "apogee_km": round(apogee_km, 1),
            "epoch": epoch_dt.isoformat() if epoch_dt else "",
            "inclination_deg": round(inclination, 4),
            "raan_deg": round(float(tle2[17:25]), 4),
            "eccentricity": round(eccentricity, 7),
            "arg_perigee_deg": round(float(tle2[34:42]), 4),
            "mean_anomaly_deg": round(float(tle2[43:51]), 4),
            "mean_motion_rev_per_day": round(mean_motion, 6),
            "period_min": round(period_min, 4),
        }
    except (IndexError, TypeError, ValueError):
        return {}
