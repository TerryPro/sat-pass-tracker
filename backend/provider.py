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

from catalog import FALLBACK_SATELLITES  # noqa: E402

logger = logging.getLogger(__name__)

# 常见浏览器 UA，避免部分数据源（SatNOGS / CelesTrak）拒绝默认 UA
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# 内置卫星配置：NORAD ID + 默认显示名 + 历史兜底 TLE + 别名。
# 数据来源为 backend/config/satellites.json（catalog），此处不重复硬编码。
_SATELLITES = FALLBACK_SATELLITES


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
    """解析 SatNOGS / CelesTrak 返回的单个卫星 3LE/2LE 文本。

    名称行缺失（2LE）时返回空名称，由调用方按 NORAD 补全，避免硬编码错误卫星名。
    """
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if len(lines) >= 3 and lines[1].startswith("1 ") and lines[2].startswith("2 "):
        return lines[0], lines[1], lines[2]
    if len(lines) >= 2 and lines[0].startswith("1 ") and lines[1].startswith("2 "):
        return "", lines[0], lines[1]
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
                    # 2LE 响应无名称行：按内置配置或 NORAD 号补全，避免名字写错
                    if not name:
                        cfg = _SATELLITES.get(norad_id)
                        name = cfg["name"] if cfg else str(norad_id)
                    logger.info("在线获取 TLE 成功: %s (%s)", name, norad_id)
                    return name, l1, l2
        except Exception as exc:
            logger.warning("TLE 源 %s 获取失败: %s", src_name, exc)
    return None


def fetch_latest_tle(norad_id: int = 24278, timeout: int = 15) -> Optional[Tuple[str, str, str, bool]]:
    """按优先级从多个在线源获取指定 NORAD ID 卫星的最新 TLE；失败则返回历史兜底。

    返回 (name, tle1, tle2, is_fallback)：is_fallback 为 True 表示在线源全部失败、
    实际返回的是内置历史 TLE（可能已过时），供上层在响应中向用户透明提示。
    仅内置卫星（_SATELLITES 配置）才有历史兜底；非内置卫星在线源全部失败时
    返回 None，避免把别的卫星（如 FO-29）的轨道数据冒充目标卫星。
    """
    cfg = _SATELLITES.get(norad_id)
    online = fetch_tle_online(norad_id, timeout=timeout)
    if online is not None:
        return (*online, False)
    if cfg is None:
        logger.warning("在线 TLE 源均失败且无内置历史 TLE: NORAD %s", norad_id)
        return None
    logger.warning("所有在线 TLE 源均失败，使用 %s 历史 TLE 回退值", cfg["name"])
    return (*cfg["fallback"], True)
