"""
网络数据源层：TLE / 卫星信息 / AMSAT 频率的在线获取与解析。

只负责网络 IO 与文本解析，不含计算逻辑与持久化；
获取失败返回 None / 空值，由调用方（tle.py / 路由）决定兜底策略。
"""

from __future__ import annotations

import json
import logging
import urllib.request
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# 常见浏览器 UA，避免部分数据源（SatNOGS / CelesTrak）拒绝默认 UA
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# 内置卫星配置：NORAD ID + 默认显示名 + 历史兜底 TLE
_SATELLITES = {
    24278: {
        "name": "FO-29",
        "fallback": (
            "JAS 2",
            "1 24278U 96046B   26223.09493086 -.00000008  00000-0  30637-4 0  9994",
            "2 24278  98.5199  64.4403 0349059 314.0923  43.1968 13.5327675048059",
        ),
        # 在 AMSat nasabare.txt 中的识别关键字
        "aliases": ["FO-29", "FO 29", "JAS-2", "JAS 2", "FUJI"],
    },
    25544: {
        "name": "ISS",
        "fallback": (
            "ISS",
            "1 25544U 98067A   26224.50000000  .00000000  00000-0  00000-0 0  9999",
            "2 25544  51.6416  89.5000 0005000  90.0000  270.0000 15.50995500    00",
        ),
        "aliases": ["ISS", "ZARYA", "INTERNATIONAL SPACE STATION"],
    },
    48274: {
        "name": "CSS",
        "fallback": (
            "CSS",
            "1 48274U 21035A   26224.50000000  .00000000  00000-0  00000-0 0  9999",
            "2 48274  41.4700  89.5000 0005000  90.0000  270.0000 15.61640500    00",
        ),
        "aliases": ["CSS", "TIANHE", "CHINA SPACE STATION", "TIANZHOU"],
    },
}


def get_builtin_tle(norad_id: int) -> Optional[Tuple[str, str, str]]:
    """返回内置历史 TLE（(name, tle1, tle2)）；非内置卫星返回 None。

    供离线模式（tle_mode=builtin）直接使用，不触发任何网络请求。
    """
    cfg = _SATELLITES.get(int(norad_id))
    return cfg["fallback"] if cfg else None


def _tle_sources(norad_id: int):
    """按 NORAD ID 生成候选 TLE 源列表。"""
    return [
        (
            "satnogs",
            f"https://db.satnogs.org/api/tle/?norad_cat_id={norad_id}&format=3le",
            "_parse_single_3le",
        ),
        # CelesTrak 单星查询（部分网络环境下会 403）
        (
            "celestrak",
            f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE",
            "_parse_single_3le",
        ),
    ]


def _http_get(url: str, timeout: int = 15) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": _BROWSER_UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def fetch_satellite_info_online(norad_id: int, timeout: int = 20) -> Optional[dict]:
    """从 SatNOGS 数据库获取卫星基本信息（别名/状态/发射日期/运营方/国家等）。

    卫星不在库中或请求失败时返回 None。
    """
    url = (
        "https://db.satnogs.org/api/satellites/"
        f"?norad_cat_id={norad_id}&format=json"
    )
    try:
        body = _http_get(url, timeout=timeout)
        data = json.loads(body)
    except Exception:
        return None
    if not isinstance(data, list) or not data:
        return None
    s = data[0]
    # 图片：API 返回相对路径（如 satellites/xxx.jpg），拼 SatNOGS 静态资源前缀成完整 URL
    img = s.get("image") or ""
    return {
        "name": s.get("name") or "",
        "names": s.get("names") or "",
        "status": s.get("status") or "",
        "launch_date": s.get("launched") or "",
        "operator": s.get("operator") or "",
        "countries": s.get("countries") or "",
        "website": s.get("website") or "",
        "telemetries": [t.get("decoder") for t in (s.get("telemetries") or [])],
        "image": img,
        "image_url": f"https://db.satnogs.org/media/{img}" if img else "",
    }


# AMSAT 业余卫星频率数据库（GitHub 机器可读文件，活跃卫星）
_AMSAT_FREQ_URL = (
    "https://raw.githubusercontent.com/palewire/amateur-satellite-database/"
    "main/data/amsat-active-frequencies.json"
)


def fetch_amsat_frequencies_online(timeout: int = 20) -> list:
    """从 AMSAT 业余卫星数据库拉取活跃卫星频率列表。

    返回 [{ name, norad_id, uplink, downlink, beacon, mode, callsign }]；
    失败返回空列表。
    """
    try:
        body = _http_get(_AMSAT_FREQ_URL, timeout=timeout)
        data = json.loads(body)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    out = []
    for s in data:
        if not isinstance(s, dict):
            continue
        out.append(
            {
                "name": s.get("name") or "",
                "norad_id": str(s.get("norad_id") or ""),
                "uplink": s.get("uplink") or "",
                "downlink": s.get("downlink") or "",
                "beacon": s.get("beacon") or "",
                "mode": s.get("mode") or "",
                "callsign": s.get("callsign") or "",
            }
        )
    return out


def _parse_single_3le(body: str) -> Optional[Tuple[str, str, str]]:
    """解析 SatNOGS / CelesTrak 返回的单个卫星 3LE/2LE 文本。"""
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if len(lines) >= 3 and lines[1].startswith("1 ") and lines[2].startswith("2 "):
        return lines[0], lines[1], lines[2]
    if len(lines) >= 2 and lines[0].startswith("1 ") and lines[1].startswith("2 "):
        return "FO-29", lines[0], lines[1]
    return None


def _parse_sat_from_3le_list(body: str, norad_id: int) -> Optional[Tuple[str, str, str]]:
    """从 3LE 列表中解析指定 NORAD ID 的 TLE。"""
    cfg = _SATELLITES.get(norad_id)
    aliases = cfg["aliases"] if cfg else []
    norad_str = str(norad_id)
    lines = [ln.rstrip() for ln in body.splitlines()]
    # 3LE 格式：name / line1 / line2，每 3 行一组
    for i in range(0, len(lines) - 2, 1):
        name = lines[i].strip()
        l1 = lines[i + 1].strip()
        l2 = lines[i + 2].strip()
        if not l1.startswith("1 ") or not l2.startswith("2 "):
            continue
        # 优先按 NORAD ID 匹配（TLE 第 1 行第 3-7 列）
        if l1[2:7].strip() == norad_str:
            return name or (cfg["name"] if cfg else norad_str), l1, l2
        # 其次按名称别名匹配
        up = name.upper()
        if any(a.upper() in up for a in aliases):
            return name or (cfg["name"] if cfg else norad_str), l1, l2
    return None


def fetch_tle_online(norad_id: int, timeout: int = 20):
    """仅从在线源获取指定 NORAD ID 的 TLE，失败返回 None（不回落历史 TLE）。

    用于卫星导入：只有真正拿到有效 TLE 才允许加入卫星列表。
    """
    for src_name, url, parser_name in _tle_sources(norad_id):
        try:
            body = _http_get(url, timeout=timeout)
            parser = globals()[parser_name]
            result = parser(body)
            if result is not None:
                name, l1, l2 = result
                if l1.startswith("1 ") and l2.startswith("2 ") and str(norad_id) in l1[2:8]:
                    logger.info("在线获取 TLE 成功: %s (%s)", name, norad_id)
                    return name, l1, l2
        except Exception as exc:
            logger.warning("TLE 源 %s 获取失败: %s", src_name, exc)
    return None


def fetch_latest_tle(norad_id: int = 24278, timeout: int = 15) -> Tuple[str, str, str, bool]:
    """按优先级从多个在线源获取指定 NORAD ID 卫星的最新 TLE；失败则返回历史兜底。

    返回 (name, tle1, tle2, is_fallback)：is_fallback 为 True 表示在线源全部失败、
    实际返回的是内置历史 TLE（可能已过时），供上层在响应中向用户透明提示。
    """
    cfg = _SATELLITES.get(norad_id, _SATELLITES[24278])
    online = fetch_tle_online(norad_id, timeout=timeout)
    if online is not None:
        return (*online, False)
    logger.warning("所有在线 TLE 源均失败，使用 %s 历史 TLE 回退值", cfg["name"])
    return (*cfg["fallback"], True)
