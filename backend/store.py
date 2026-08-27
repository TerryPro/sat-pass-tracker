"""
持久化层：设置 / 卫星列表 / TLE / 卫星信息缓存的 JSON 文件读写与规范化。

数据文件位于 backend/data/（可用 GS_DATA_DIR 或 backend/.env 覆盖），
写入方式为"读取-合并-整体写回"，支持分字段保存（如只保存主题）。

所有写文件均通过 _atomic_write_json 完成：先写同目录临时文件，再 os.replace
原子替换，避免进程中断导致 JSON 半写损坏；加载/保存异常会记录日志。
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time

import config
from provider import fetch_amsat_frequencies_online  # noqa: E402

logger = logging.getLogger("store")

# 持久化读-改-写保护锁：请求改走线程池后，多线程可并发进入存储层。
# 用 RLock 保证每次 _save_* 的"读取最新文件 → 合并 → 原子写回"是原子的，
# 避免并发写同一文件时基于过期快照覆盖彼此的更新。
_store_lock = threading.RLock()


def _atomic_write_json(path, data) -> None:
    """原子写 JSON：先写同目录临时文件，再 os.replace 覆盖目标。

    即使进程在写入中途被终止，目标文件也只会是旧的完整内容或新的完整内容，
    不会出现半截 JSON；写入失败时清理临时文件并记录日志。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except OSError:
        logger.exception("原子写入失败: %s", path)
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    except Exception:
        logger.exception("序列化失败: %s", path)
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

# ---------------------------------------------------------------
# 运行时数据目录与文件
# ---------------------------------------------------------------
_DATA_DIR = config.DATA_DIR
_SETTINGS_FILE = _DATA_DIR / "settings.json"
_TLES_FILE = _DATA_DIR / "tles.json"  # TLE 持久化文件
_SATINFO_FILE = _DATA_DIR / "satellite_info.json"  # 卫星介绍/频率缓存

# 内置卫星（不可删除）：可从网络导入更多卫星（按 NORAD 目录号）
_BUILTIN_SATELLITES = [
    {"id": "fo29", "name": "FO-29 (JAS-2)", "norad_id": 24278, "builtin": True},
    {"id": "iss", "name": "国际空间站 ISS", "norad_id": 25544, "builtin": True},
    {"id": "css", "name": "中国空间站 CSS", "norad_id": 48274, "builtin": True},
]

# 常用卫星目录：供按名称搜索导入（中英文别名匹配，TLE 在线获取）
_COMMON_SATELLITES = [
    {"name": "国际空间站 ISS", "aliases": ["iss", "zarya", "iss (zarya)", "国际空间站"], "norad_id": 25544},
    {"name": "中国空间站 CSS", "aliases": ["css", "tianhe", "tianzhou", "china space station", "中国空间站", "天宫", "天和"], "norad_id": 48274},
    {"name": "FO-29 (JAS-2)", "aliases": ["fo29", "fo-29", "jas-2", "jas 2"], "norad_id": 24278},
    {"name": "NOAA-15", "aliases": ["noaa 15", "noaa15"], "norad_id": 25338},
    {"name": "NOAA-18", "aliases": ["noaa 18", "noaa18"], "norad_id": 28654},
    {"name": "NOAA-19", "aliases": ["noaa 19", "noaa19"], "norad_id": 33591},
    {"name": "Meteor-M2", "aliases": ["meteor", "meteor m2", "meteor-m2"], "norad_id": 40069},
    {"name": "Meteor-M2-2", "aliases": ["meteor m2 2", "meteor-m2-2"], "norad_id": 44387},
    {"name": "风云一号 C (FY-1C)", "aliases": ["fy-1c", "fy 1c", "风云一号"], "norad_id": 25730},
    {"name": "风云三号 C (FY-3C)", "aliases": ["fy-3c", "fy 3c", "风云三号"], "norad_id": 39260},
    {"name": "风云三号 D (FY-3D)", "aliases": ["fy-3d", "fy 3d"], "norad_id": 43010},
    {"name": "风云四号 A (FY-4A)", "aliases": ["fy-4a", "fy 4a", "风云四号"], "norad_id": 41882},
    {"name": "风云四号 B (FY-4B)", "aliases": ["fy-4b", "fy 4b"], "norad_id": 47828},
    {"name": "哈勃空间望远镜 Hubble", "aliases": ["hubble", "hst"], "norad_id": 20580},
    {"name": "Terra (EOS AM-1)", "aliases": ["terra", "eos am"], "norad_id": 25994},
    {"name": "Aqua (EOS PM-1)", "aliases": ["aqua", "eos pm"], "norad_id": 27424},
    {"name": "Aura", "aliases": ["aura", "eos aura"], "norad_id": 28376},
    {"name": "Landsat-8", "aliases": ["landsat 8", "landsat8"], "norad_id": 39084},
    {"name": "Sentinel-2A", "aliases": ["sentinel 2a", "sentinel-2a"], "norad_id": 40697},
    {"name": "GOES-16", "aliases": ["goes 16", "goes16"], "norad_id": 41866},
    {"name": "资源三号 ZY-3", "aliases": ["zy-3", "zy 3", "资源三号"], "norad_id": 38046},
    {"name": "高分一号 GF-1", "aliases": ["gf-1", "gf 1", "高分一号"], "norad_id": 39150},
]

# 内置地面站（不可删除）：仅管理经纬度 + 海拔
_BUILTIN_STATIONS = [
    {
        "id": "on80dd",
        "name": "ON80DD",
        "lat": config.ON80DD_LAT,
        "lon": config.ON80DD_LON,
        "alt": config.ON80DD_ALT_M,
        "builtin": True,
    },
    {
        "id": "beijing",
        "name": "北京",
        "lat": config.DEFAULT_LAT,
        "lon": config.DEFAULT_LON,
        "alt": config.DEFAULT_ALT_M,
        "builtin": True,
    },
]

DEFAULT_SETTINGS = {
    "lat": config.DEFAULT_LAT,
    "lon": config.DEFAULT_LON,
    "alt": config.DEFAULT_ALT_M,
    "satellite": "fo29",
    "hours": 48,
    "sample_interval": 60,
    "theme": "dark",
    "stations": list(_BUILTIN_STATIONS),
    "satellites": list(_BUILTIN_SATELLITES),
    # 2D 地图晨昏线显示项：橘黄虚线分界（叠加在夜影之上）
    "terminator_show_dashed": True,
}


def _normalize_stations(stations) -> list:
    """规范化站点列表：内置站点始终保留（不可删除），自定义站点按 id 去重。"""
    merged: list = []
    seen: set = set()
    for s in _BUILTIN_STATIONS:
        merged.append(dict(s))
        seen.add(s["id"])
    if isinstance(stations, list):
        for s in stations:
            if not isinstance(s, dict) or "id" not in s:
                continue
            sid = str(s["id"])
            if sid in seen:
                continue
            try:
                lat = float(s["lat"])
                lon = float(s["lon"])
                alt = float(s.get("alt", config.DEFAULT_ALT_M))
            except (KeyError, TypeError, ValueError):
                continue
            seen.add(sid)
            merged.append(
                {
                    "id": sid,
                    "name": str(s.get("name") or sid),
                    "lat": lat,
                    "lon": lon,
                    "alt": alt,
                    "builtin": False,
                }
            )
    return merged


def _normalize_satellites(sats) -> list:
    """规范化卫星列表：内置卫星始终保留，自定义卫星按 id / norad_id 去重。"""
    merged: list = []
    seen_ids: set = set()
    seen_norads: set = set()
    for s in _BUILTIN_SATELLITES:
        merged.append(dict(s))
        seen_ids.add(s["id"])
        seen_norads.add(s["norad_id"])
    if isinstance(sats, list):
        for s in sats:
            if not isinstance(s, dict) or "id" not in s:
                continue
            sid = str(s["id"])
            if sid in seen_ids:
                continue
            try:
                nid = int(s["norad_id"])
            except (KeyError, TypeError, ValueError):
                continue
            if nid in seen_norads:
                continue
            seen_ids.add(sid)
            seen_norads.add(nid)
            merged.append(
                {
                    "id": sid,
                    "name": str(s.get("name") or sid),
                    "norad_id": nid,
                    "builtin": False,
                }
            )
    return merged


def _load_satellites() -> list:
    """读取卫星列表（内置 + 自定义）。"""
    return _normalize_satellites(_load_settings().get("satellites"))


def _save_satellites(sats: list) -> list:
    """规范化并保存卫星列表到设置文件。"""
    normalized = _normalize_satellites(sats)
    cur = _load_settings()
    cur["satellites"] = normalized
    _save_settings(cur)
    return normalized


def _load_settings() -> dict:
    """读取持久化设置；文件不存在或损坏时返回默认值。"""
    try:
        if _SETTINGS_FILE.exists():
            data = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
            merged = dict(DEFAULT_SETTINGS)
            merged.update({k: v for k, v in data.items() if k in DEFAULT_SETTINGS and k not in ("stations", "satellites")})
            merged["stations"] = _normalize_stations(data.get("stations"))
            merged["satellites"] = _normalize_satellites(data.get("satellites"))
            return merged
    except (OSError, ValueError):
        logger.warning("读取设置失败，回退默认值: %s", _SETTINGS_FILE, exc_info=True)
    return dict(DEFAULT_SETTINGS)


def _save_settings(settings: dict) -> dict:
    """合并并保存设置：仅更新传入的已知字段，未传字段保持当前值（支持分卡保存）。"""
    with _store_lock:
        merged = _load_settings()
        for k, v in settings.items():
            if k in DEFAULT_SETTINGS and k not in ("stations", "satellites"):
                merged[k] = v
        if "stations" in settings:
            merged["stations"] = _normalize_stations(settings["stations"])
        if "satellites" in settings:
            merged["satellites"] = _normalize_satellites(settings["satellites"])
        _atomic_write_json(_SETTINGS_FILE, merged)
    logger.info("设置已保存: %s", _SETTINGS_FILE)
    return merged


def _load_tles() -> dict:
    """读取持久化 TLE：{ norad_id 字符串: { name, tle1, tle2, fetched_ts } }。"""
    try:
        if _TLES_FILE.exists():
            data = json.loads(_TLES_FILE.read_text(encoding="utf-8"))
            # 内容格式异常（非 dict）时按空处理，避免调用方 .get() 报错
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        logger.warning("读取 TLE 缓存失败，按空处理: %s", _TLES_FILE, exc_info=True)
    return {}


def _save_tle(
    norad_id: int,
    name: str,
    tle1: str,
    tle2: str,
    fetched_ts: float,
    source: str = "online",
) -> None:
    """把最新 TLE 写入持久化文件（供重启后复用）；source 记录数据来源（online/fallback）。"""
    with _store_lock:
        tles = _load_tles()
        tles[str(norad_id)] = {
            "name": name,
            "tle1": tle1,
            "tle2": tle2,
            "fetched_ts": fetched_ts,
            "source": source,
        }
        _atomic_write_json(_TLES_FILE, tles)
    logger.info("TLE 已保存: norad=%s source=%s", norad_id, source)


def _load_sat_info() -> dict:
    """读取卫星介绍/频率缓存：{ norad_id: { description, mode, frequencies, fetched_ts } }。"""
    try:
        if _SATINFO_FILE.exists():
            data = json.loads(_SATINFO_FILE.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        logger.warning("读取卫星信息缓存失败，按空处理: %s", _SATINFO_FILE, exc_info=True)
    return {}


def _save_sat_info(norad_id: int, info: dict, fetched_ts: float) -> None:
    """写入卫星介绍/频率缓存。"""
    infos = _load_sat_info()
    infos[str(norad_id)] = {**info, "fetched_ts": fetched_ts}
    _atomic_write_json(_SATINFO_FILE, infos)
    logger.info("卫星信息已保存: norad=%s", norad_id)


# ---------------------------------------------------------------
# AMSAT 频率表内存缓存（24h 过期，避免每次请求都拉取 83KB 文件）
# ---------------------------------------------------------------
_AMSAT_FREQ_MAP: dict = {}
_AMSAT_FREQ_FETCHED_AT: float = 0.0
_AMSAT_FREQ_TTL = 24 * 3600.0
# 对 AMSAT 频率表初始化的锁：并发的第一个请求负责联网拉取，其余复用结果
# （避免每次请求改走线程池后多个线程同时触发 83KB 文件下载）。
_amsat_freq_lock = threading.Lock()


def _get_amsat_freq_map() -> dict:
    """返回按 norad_id 分组的 AMSAT 频率表。"""
    global _AMSAT_FREQ_MAP, _AMSAT_FREQ_FETCHED_AT
    now = time.time()
    if _AMSAT_FREQ_MAP and (now - _AMSAT_FREQ_FETCHED_AT) < _AMSAT_FREQ_TTL:
        return _AMSAT_FREQ_MAP
    with _amsat_freq_lock:
        # 双检锁：等待中的线程拿到锁后复查缓存是否已就绪
        if _AMSAT_FREQ_MAP and (time.time() - _AMSAT_FREQ_FETCHED_AT) < _AMSAT_FREQ_TTL:
            return _AMSAT_FREQ_MAP
        try:
            rows = fetch_amsat_frequencies_online()
        except Exception:
            logger.warning("AMSAT 频率在线获取失败，使用空表", exc_info=True)
            rows = []
        by_norad: dict = {}
        for r in rows:
            by_norad.setdefault(r["norad_id"], []).append(r)
        _AMSAT_FREQ_MAP = by_norad
        _AMSAT_FREQ_FETCHED_AT = time.time()
        return _AMSAT_FREQ_MAP


# ---------------------------------------------------------------
# 卫星数据文件目录：下载的原始数据源文件保存目录（不入库，直接留档）。
# 位于运行时数据目录之下（GS_DATA_DIR 可覆盖），随 backend/data 一并忽略版本控制。
# 实际读写由 lib 模块负责：lib.download_group 写入 <key>.tle，lib 从文件系统列出/解析。
# ---------------------------------------------------------------
SATELLITE_FILES_DIR = _DATA_DIR / "satellite_files"
