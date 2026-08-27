"""
卫星数据文件管理 REST 路由：
    GET  /api/library/meta       列出可用数据源组 + 本地文件是否已下载/条数/时间
    POST /api/library/download   下载某数据源组原始文件到本地目录（同步返回）
    GET  /api/library/entries    浏览已下载原始文件解析出的卫星数据（支持名称/NORAD 搜索、按来源过滤）
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from exceptions import NotFoundError, ValidationError  # noqa: E402
from lib import (  # noqa: E402
    download_group,
    list_all_entries,
    list_categories,
    list_downloaded,
    list_groups,
    read_group_entries,
)

router = APIRouter()


def _group_status(g: dict, downloaded: dict) -> dict:
    """组定义 + 本地文件状态。"""
    local = downloaded.get(g["key"])
    return {
        "key": g["key"],
        "label": g["label"],
        "url": g["url"],
        "downloaded": bool(local),
        "count": local.get("count", 0) if local else 0,
        "size": local.get("size", 0) if local else 0,
        "fetched_at": local.get("fetched_at") if local else None,
    }


@router.get("/api/library/meta")
def library_meta():
    """返回按六大分类组织的数据源组 + 本地是否已下载文件（条数/大小/更新时间）。

    兼容：同时提供 categories（分类树）与 groups（平铺），供前端两种渲染方式选用。
    """
    downloaded = {d["key"]: d for d in list_downloaded()}
    categories = []
    groups = []
    for cat in list_categories():
        cat_groups = [_group_status(g, downloaded) for g in cat["groups"]]
        categories.append({"key": cat["key"], "label": cat["label"], "groups": cat_groups})
        groups.extend(cat_groups)
    total = sum(len(read_group_entries(d["key"]) or []) for d in downloaded.values())
    return {"categories": categories, "groups": groups, "total_entries": total}


@router.post("/api/library/download")
def library_download(payload: dict):
    """下载指定 CelesTrak 组原始文件到本地目录；同步返回；同组覆盖更新。"""
    key = str(payload.get("key", "")).strip()
    result = download_group(key)
    if result is None:
        valid_keys = [g["key"] for g in list_groups()]
        if key not in valid_keys:
            raise ValidationError(f"未知的数据源组: {key}")
        raise NotFoundError(f"数据源组下载失败: {key}（网络不可达或返回为空）")
    return result


@router.get("/api/library/entries")
def library_entries(q: str = "", source: str = ""):
    """浏览已下载原始文件解析出的卫星数据。

    q: 名称 / NORAD 号模糊匹配；source: 指定只读某组文件（留空 = 全部已下载组）。
    """
    if source:
        parsed = read_group_entries(source) or []
    else:
        parsed = list_all_entries()

    q = q.strip().lower()
    if q:
        if q.isdigit():
            parsed = [e for e in parsed if str(e["norad_id"]) == q or q in str(e["norad_id"])]
        else:
            parsed = [e for e in parsed if q in (e.get("name") or "").lower()]
    parsed.sort(key=lambda e: (e.get("name") or "").lower())
    return {
        "count": len(parsed),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entries": parsed,
    }
