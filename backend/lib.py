"""
卫星数据文件层：从标准数据源下载原始 TLE 文件并留档于磁盘目录。

区别于"解析入库"：这里只负责 网络 IO + 目录管理，把 CelesTrak 组文件
原样保存为 <运行数据目录>/satellite_files/<key>.tle，不做结构化持久化；
浏览时再按需解析返回。多组可重复下载，同组更新直接覆盖该组文件。
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from typing import List, Optional

import provider  # noqa: E402
import store  # noqa: E402

logger = logging.getLogger(__name__)

# 卫星数据文件目录统一经 store 动态获取：运行中二者一致（都源自 config.DATA_DIR），
# 测试可通过 monkeypatch store.SATELLITE_FILES_DIR 隔离目录而无快照问题。
def _files_dir():
    return store.SATELLITE_FILES_DIR

# 常见浏览器 UA，避免 CelesTrak 拒绝默认 UA
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# 可下载的 CelesTrak 组文件。按官方 index.php?FORMAT=tle 的六大分类组织。
# 组名均为 CelesTrak 官方分类（经逐组实测有效；不要用 earth-resources 之类非官方名，会返回 Invalid query）。
_CELESTRAK_TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={key}&FORMAT=tle"


def _group(key: str, label: str) -> dict:
    return {"key": key, "label": label, "url": _CELESTRAK_TLE_URL.format(key=key)}


# 六大分类 -> 各组。category 的 key/label 供前端分组展示。
CELESTRAK_CATEGORIES = [
    {
        "key": "special",
        "label": "特种卫星 (Special-Interest)",
        "groups": [
            _group("stations", "载人空间站"),
        ],
    },
    {
        "key": "weather",
        "label": "气象与地球资源",
        "groups": [
            _group("weather", "气象卫星"),
            _group("resource", "地球资源卫星"),
            _group("sar", "合成孔径雷达 (SAR)"),
            _group("dmc", "灾害监测 (DMC)"),
        ],
    },
    {
        "key": "comm",
        "label": "通信卫星",
        "groups": [
            _group("amateur", "业余卫星 (Amateur)"),
            _group("satnogs", "SatNOGS"),
            _group("oneweb", "OneWeb"),
            _group("qianfan", "千帆星座 (Qianfan)"),
            _group("geo", "地球静止轨道 (GEO)"),
        ],
    },
    {
        "key": "nav",
        "label": "导航卫星",
        "groups": [
            _group("gnss", "GNSS 全球导航"),
            _group("gps-ops", "GPS 在轨"),
            _group("galileo", "Galileo 伽利略"),
            _group("beidou", "北斗 (BeiDou)"),
            _group("glo-ops", "GLONASS 在轨"),
        ],
    },
    {
        "key": "science",
        "label": "科学卫星",
        "groups": [
            _group("science", "空间与地球科学"),
            _group("education", "教育卫星"),
        ],
    },
    {
        "key": "misc",
        "label": "其它卫星",
        "groups": [
            _group("cubesat", "立方体卫星 (CubeSats)"),
        ],
    },
]

# 平铺索引：每个组附带其所属分类（供 meta 分组展示 / 下载校验）
CELESTRAK_GROUPS = [
    {**g, "category": cat["key"], "category_label": cat["label"]}
    for cat in CELESTRAK_CATEGORIES
    for g in cat["groups"]
]

_GROUP_MAP = {g["key"]: g for g in CELESTRAK_GROUPS}


def list_categories() -> list:
    """返回分类树：[{key,label,groups:[{key,label,url}]}]，供 meta 分组展示。"""
    return [{"key": c["key"], "label": c["label"], "groups": [dict(g) for g in c["groups"]]} for c in CELESTRAK_CATEGORIES]


def list_groups() -> list:
    """返回所有可用数据源组的定义（平铺，含 category，不含本地文件状态）。"""
    return [dict(g) for g in CELESTRAK_GROUPS]


def _http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": _BROWSER_UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


# ---------------------------------------------------------------
# 目录与原始文件管理
# ---------------------------------------------------------------
def files_dir_ensure() -> None:
    """确保卫星数据文件目录存在。"""
    _files_dir().mkdir(parents=True, exist_ok=True)


def group_file_path(key: str):
    """返回指定组对应的原始数据文件路径（如 <dir>/amateur.tle）。"""
    return _files_dir() / f"{key}.tle"


def parse_3le(body: str) -> List[dict]:
    """解析 CelesTrak 3LE 组文件文本，返回 [{norad_id, name, tle1, tle2}]。

    组文件每 3 行为一组：第 1 行是卫星名，第 2/3 行是两行 TLE。
    NORAD 号从 TLE 第 1 行第 2~7 列取。
    """
    lines = [ln.rstrip("\r\n") for ln in body.splitlines()]
    out: List[dict] = []
    i = 0
    while i + 2 < len(lines):
        name = lines[i].strip()
        l1 = lines[i + 1].strip()
        l2 = lines[i + 2].strip()
        if not (l1.startswith("1 ") and l2.startswith("2 ")):
            i += 1
            continue
        norad_str = l1[2:7].strip()
        if norad_str.isdigit():
            out.append({"norad_id": int(norad_str), "name": name or norad_str, "tle1": l1, "tle2": l2})
        i += 3
    return out


def group_count(body: str) -> int:
    """统计一个 3LE 文本中的卫星数量（3 线一组）。"""
    return len(parse_3le(body))


def _atomic_write_text(path, text: str) -> None:
    """先写同目录临时文件再 os.replace，避免进程中断导致半写。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except OSError:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def download_group(key: str, timeout: int = 20) -> Optional[dict]:
    """下载指定 CelesTrak 组原始文件并保存到目录（同组覆盖更新）。

    原始文本不解析入库，直接以 <key>.tle 留档。
    返回 { key, label, path, count, fetched_at }；组不存在或下载/写入失败返回 None。
    """
    group = _GROUP_MAP.get(key)
    if group is None:
        return None
    try:
        body = _http_get(group["url"], timeout=timeout)
    except Exception as exc:
        logger.warning("CelesTrak 组 %s 下载失败: %s", key, exc)
        return None

    try:
        _atomic_write_text(group_file_path(key), body)
    except OSError as exc:
        logger.warning("CelesTrak 组 %s 写入失败: %s", key, exc)
        return None

    return {
        "key": key,
        "label": group["label"],
        "path": str(group_file_path(key)),
        "count": group_count(body),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------
# 浏览：从已下载的原始文件读取并解析
# ---------------------------------------------------------------
def list_downloaded() -> List[dict]:
    """列出目录中已下载的组文件（含文件信息与条数）。"""
    dir_ = _files_dir()
    dir_.mkdir(parents=True, exist_ok=True)
    out: List[dict] = []
    for path in sorted(dir_.glob("*.tle")):
        key = path.stem
        group = _GROUP_MAP.get(key)
        label = group["label"] if group else key
        try:
            body = path.read_text(encoding="utf-8", errors="ignore")
            count = group_count(body)
        except OSError:
            continue
        st = path.stat()
        out.append(
            {
                "key": key,
                "label": label,
                "path": str(path),
                "count": count,
                "size": st.st_size,
                "fetched_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            }
        )
    return out


def read_group_entries(key: str) -> Optional[List[dict]]:
    """读取并解析指定组文件的卫星数据；无该文件或无法识别时返回 None。

    返回条目带 source（=key）与 tle_fetched_at（来源文件修改时间）。
    """
    path = group_file_path(key)
    if not path.exists():
        return None
    try:
        body = path.read_text(encoding="utf-8", errors="ignore")
        parsed = parse_3le(body)
    except OSError:
        return None
    if not parsed:
        return None
    fetched = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    for e in parsed:
        e["tle_fetched_at"] = fetched
        e["source"] = key
    return parsed


def list_all_entries() -> List[dict]:
    """合并目录中所有已下载组文件的卫星数据（供无来源过滤时的全量浏览）。"""
    out: List[dict] = []
    for info in list_downloaded():
        entries = read_group_entries(info["key"])
        if entries:
            out.extend(entries)
    return out


def find_entry_by_norad(norad_id: int) -> Optional[dict]:
    """在所有已下载组文件中查找指定 NORAD 号的卫星（返回第一条匹配）。

    复用 read_group_entries 的解析结果；未找到返回 None。
    """
    norad_str = str(norad_id)
    for info in list_downloaded():
        entries = read_group_entries(info["key"]) or []
        for e in entries:
            if str(e["norad_id"]) == norad_str:
                return e
    return None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def get_satellite_info(norad_id: int, refresh: bool = False) -> Optional[dict]:
    """获取并缓存卫星档案信息（SatNOGS 基本信息 + AMSAT 频率）。

    返回 { norad_id, names, status, launch_date, operator, countries, website,
            telemetries, frequencies, fetched_at }；
    若 SatNOGS 中无此星（或联网失败）返回 None 且不写入缓存（避免误缓存）。
    refresh=True 忽略缓存并强制重新联网。
    """
    saved = store._load_sat_info().get(str(norad_id))
    if saved and not refresh:
        return _serialize_info(saved, norad_id)
    try:
        meta = provider.fetch_satellite_info_online(norad_id) or {}
    except Exception:
        meta = {}
    # SatNOGS 未收录（空结果）→ 视为"无档案"，返回 None 且不缓存
    if not meta.get("name") and not meta.get("names"):
        return None
    freqs = store._get_amsat_freq_map().get(str(norad_id), [])
    info = {
        "names": meta.get("names", ""),
        "status": meta.get("status", ""),
        "launch_date": meta.get("launch_date", ""),
        "operator": meta.get("operator", ""),
        "countries": meta.get("countries", ""),
        "website": meta.get("website", ""),
        "telemetries": meta.get("telemetries", []),
        "frequencies": freqs,
        "image_url": meta.get("image_url", ""),
    }
    fetched_ts = time.time()
    store._save_sat_info(norad_id, info, fetched_ts)
    return _serialize_info({**info, "fetched_ts": fetched_ts}, norad_id)


def _serialize_info(info: dict, norad_id: int) -> dict:
    ts = info.get("fetched_ts")
    base = {
        "norad_id": norad_id,
        "names": info.get("names", ""),
        "status": info.get("status", ""),
        "launch_date": info.get("launch_date", ""),
        "operator": info.get("operator", ""),
        "countries": info.get("countries", ""),
        "website": info.get("website", ""),
        "telemetries": info.get("telemetries", []),
        "frequencies": info.get("frequencies", []),
        "image_url": info.get("image_url", ""),  # 兼容旧缓存无 image 键
    }
    return {
        **base,
        "fetched_at": _iso(ts) if isinstance(ts, (int, float)) else (ts or ""),
    }
