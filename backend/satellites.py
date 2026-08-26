"""
卫星目录 REST 接口：列表 / 搜索 / 导入 / 删除 / 详情 / 介绍频率 / 手动刷新。
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter

from exceptions import NotFoundError, ValidationError  # noqa: E402
from provider import fetch_satellite_info_online, fetch_tle_online  # noqa: E402
from store import (  # noqa: E402
    _COMMON_SATELLITES,
    _get_amsat_freq_map,
    _load_sat_info,
    _load_satellites,
    _load_tles,
    _save_sat_info,
    _save_satellites,
    _save_tle,
)
from tle import (  # noqa: E402
    _INFO_VALID_SECONDS,
    _TLE_VALID_SECONDS,
    _clean_sat_name,
    _get_tle_cached,
    _parse_tle_epoch,
    _parse_tle_fields,
    tle_cache_set,
    tle_source,
)

router = APIRouter()


def _find_satellite(sat_id: str) -> dict | None:
    """按 id 或 NORAD 目录号查找卫星。"""
    sats = _load_satellites()
    return next((s for s in sats if s["id"] == sat_id or str(s["norad_id"]) == sat_id), None)


@router.get("/api/satellites")
def api_get_satellites():
    """读取卫星列表（内置 + 自定义），附带 TLE 更新时间与轨道历元。"""
    sats = _load_satellites()
    tles = _load_tles()
    out = []
    for s in sats:
        item = dict(s)
        saved = tles.get(str(s["norad_id"]))
        if saved:
            fetched_ts = float(saved["fetched_ts"])
            item["fetched_at"] = datetime.fromtimestamp(fetched_ts, tz=timezone.utc).isoformat()
            epoch = _parse_tle_epoch(saved["tle1"])
            item["epoch"] = epoch.isoformat() if epoch else ""
        else:
            item["fetched_at"] = ""
            item["epoch"] = ""
        out.append(item)
    return {"satellites": out}


@router.post("/api/satellites/search")
def api_search_satellites(payload: dict):
    """按名称或 NORAD 目录号搜索卫星（供导入前选择）。

    名称搜索：在常用卫星目录中做中英文模糊匹配，再在线获取 TLE；
    纯数字：直接按 NORAD 目录号查询。
    """
    query = str(payload.get("query", "")).strip()
    if not query:
        raise ValidationError("请输入卫星名称或 NORAD 目录号")
    # 纯数字 → 直接按 NORAD 目录号查询
    if query.isdigit():
        nid = int(query)
        tle = fetch_tle_online(norad_id=nid)
        if tle is None:
            raise NotFoundError(f"未找到 NORAD {nid} 对应的卫星")
        tle_name, tle1, tle2 = tle
        return {
            "results": [
                {
                    "name": _clean_sat_name(tle_name),
                    "norad_id": nid,
                    "tle1": tle1,
                    "tle2": tle2,
                }
            ]
        }
    # 名称搜索：在常用卫星目录中匹配（中英文，不区分大小写），即时返回候选列表
    # TLE 在用户确认导入时再在线获取，避免多颗匹配时等待过久
    q = query.lower()
    matched = [
        s for s in _COMMON_SATELLITES
        if q in s["name"].lower() or any(q in a.lower() for a in s.get("aliases", []))
    ]
    if not matched:
        raise NotFoundError(f"未找到与“{query}”匹配的卫星，可尝试英文名称或 NORAD 目录号")
    return {"results": [{"name": s["name"], "norad_id": s["norad_id"]} for s in matched[:8]]}


@router.post("/api/satellites/import")
def api_import_satellite(payload: dict):
    """按 NORAD 目录号从网络导入卫星：联网获取 TLE 验证成功后加入列表。"""
    norad = str(payload.get("norad_id", "")).strip()
    if not norad.isdigit():
        raise ValidationError("请输入有效的 NORAD 目录号（纯数字）")
    nid = int(norad)
    sats = _load_satellites()
    if any(int(s["norad_id"]) == nid for s in sats):
        raise ValidationError(f"NORAD {nid} 已在卫星列表中")
    try:
        tle = fetch_tle_online(norad_id=nid)
    except Exception as exc:
        raise ValidationError(f"获取 TLE 失败：{exc}") from exc
    if tle is None:
        raise NotFoundError(f"未能在网络上找到 NORAD {nid} 的有效 TLE（请检查目录号）")
    name, _l1, _l2 = tle
    name = _clean_sat_name(name)  # 清理前导编号（如 "0 NOAA 19" → "NOAA 19"）
    sat = {"id": str(nid), "name": name, "norad_id": nid, "builtin": False}
    sats.append(sat)
    saved = _save_satellites(sats)
    return {"satellites": saved, "satellite": sat}


@router.post("/api/satellites/delete")
def api_delete_satellite(payload: dict):
    """删除自定义卫星（内置卫星不可删除）。"""
    sid = str(payload.get("id", ""))
    sats = [s for s in _load_satellites() if not (s["id"] == sid and not s["builtin"])]
    saved = _save_satellites(sats)
    return {"satellites": saved}


@router.get("/api/satellites/{sat_id}")
def api_satellite_detail(sat_id: str):
    """卫星详情：基本信息 + 最新 TLE + 解析出的轨道根数 + 数据时间/过期状态。"""
    sat = _find_satellite(sat_id)
    if not sat:
        raise NotFoundError("卫星不存在")
    nid = int(sat["norad_id"])
    tle_name, tle1, tle2 = _get_tle_cached(nid)
    saved = _load_tles().get(str(nid))
    fetched_ts = float(saved["fetched_ts"]) if saved else None
    return {
        "id": sat["id"],
        "name": sat["name"],
        "norad_id": nid,
        "builtin": sat["builtin"],
        "tle_name": tle_name,
        "tle1": tle1,
        "tle2": tle2,
        "fetched_at": datetime.fromtimestamp(fetched_ts, tz=timezone.utc).isoformat() if fetched_ts else "",
        "tle_age_hours": round((time.time() - fetched_ts) / 3600, 1) if fetched_ts else None,
        "tle_stale": bool(fetched_ts and (time.time() - fetched_ts) > _TLE_VALID_SECONDS),
        "tle_source": tle_source(nid),
        "orbit": _parse_tle_fields(tle1, tle2),
    }


@router.get("/api/satellites/{sat_id}/info")
def api_satellite_info(sat_id: str):
    """卫星介绍与频率信息：SatNOGS 基本信息 + AMSAT 业余卫星频率（30 天本地缓存）。"""
    sat = _find_satellite(sat_id)
    if not sat:
        raise NotFoundError("卫星不存在")
    nid = int(sat["norad_id"])
    now = time.time()
    infos = _load_sat_info()
    saved = infos.get(str(nid))
    if saved and (now - float(saved.get("fetched_ts", 0))) < _INFO_VALID_SECONDS:
        info = saved
    else:
        meta = fetch_satellite_info_online(nid) or {}
        freqs = _get_amsat_freq_map().get(str(nid), [])
        info = {
            "names": meta.get("names", ""),
            "status": meta.get("status", ""),
            "launch_date": meta.get("launch_date", ""),
            "operator": meta.get("operator", ""),
            "countries": meta.get("countries", ""),
            "website": meta.get("website", ""),
            "telemetries": meta.get("telemetries", []),
            "frequencies": freqs,
            "norad_id": nid,
            "fetched_ts": now,
        }
        _save_sat_info(nid, info, now)
    return {
        "id": sat["id"],
        "name": sat["name"],
        "norad_id": nid,
        "names": info.get("names", ""),
        "status": info.get("status", ""),
        "launch_date": info.get("launch_date", ""),
        "operator": info.get("operator", ""),
        "countries": info.get("countries", ""),
        "website": info.get("website", ""),
        "telemetries": info.get("telemetries", []),
        "frequencies": info.get("frequencies", []),
        "fetched_at": datetime.fromtimestamp(float(info.get("fetched_ts", now)), tz=timezone.utc).isoformat(),
    }


@router.post("/api/satellites/{sat_id}/refresh")
def api_refresh_satellite(sat_id: str):
    """强制从网络刷新指定卫星的 TLE 并持久化（手动更新轨道数据）。"""
    sat = _find_satellite(sat_id)
    if not sat:
        raise NotFoundError("卫星不存在")
    nid = int(sat["norad_id"])
    try:
        tle = fetch_tle_online(norad_id=nid)
    except Exception as exc:
        raise ValidationError(f"在线刷新失败：{exc}") from exc
    if tle is None:
        raise ValidationError(f"在线刷新失败：未获取到 NORAD {nid} 的有效 TLE（请稍后重试）")
    tle_name, tle1, tle2 = tle
    name = _clean_sat_name(tle_name)
    now = time.time()
    _save_tle(nid, name, tle1, tle2, now, source="online")
    tle_cache_set(nid, name, tle1, tle2, now, source="online")  # 同步内存缓存
    return {
        "id": sat["id"],
        "name": name,
        "norad_id": nid,
        "builtin": sat["builtin"],
        "tle_name": name,
        "tle1": tle1,
        "tle2": tle2,
        "fetched_at": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
        "tle_age_hours": 0.0,
        "tle_stale": False,
        "tle_source": "online",
        "orbit": _parse_tle_fields(tle1, tle2),
    }


@router.post("/api/satellites/refresh-all")
def api_refresh_all_satellites():
    """批量从网络更新全部卫星的 TLE（逐颗获取并持久化，失败不影响其它卫星）。"""
    sats = _load_satellites()
    results = []
    for sat in sats:
        nid = int(sat["norad_id"])
        try:
            tle = fetch_tle_online(norad_id=nid)
        except Exception as exc:
            results.append({"id": sat["id"], "norad_id": nid, "ok": False, "error": str(exc)})
            continue
        if tle is None:
            results.append({"id": sat["id"], "norad_id": nid, "ok": False, "error": "在线获取 TLE 失败"})
            continue
        tle_name, tle1, tle2 = tle
        name = _clean_sat_name(tle_name)
        now = time.time()
        _save_tle(nid, name, tle1, tle2, now, source="online")
        tle_cache_set(nid, name, tle1, tle2, now, source="online")  # 同步内存缓存
        results.append(
            {
                "id": sat["id"],
                "norad_id": nid,
                "ok": True,
                "fetched_at": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
            }
        )
    updated = sum(1 for r in results if r["ok"])
    failed = len(results) - updated
    return {"results": results, "updated": updated, "failed": failed}
