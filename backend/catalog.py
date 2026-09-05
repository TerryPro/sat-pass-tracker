"""
内置卫星参考目录：唯一数据源为 backend/config/satellites.json。

store（内置列表种子）与 provider（离线兜底 TLE）均从本目录派生，
避免卫星数据在多处硬编码、重复维护。
目录文件缺失或损坏时回退到代码内置的最小默认（仅 ISS/CSS），保证服务仍可启动。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger("catalog")

# 受版本控制的目录文件；与 config.py 同级目录、与代码同仓维护
_CATALOG_FILE = Path(__file__).resolve().parent / "config" / "satellites.json"

# 最小默认目录：目录文件缺失/损坏时的兜底（仅内置星身份）。
# 注意：不含 TLE 数据——TLE 一律维护在 config/satellites.json，代码中不重复存放。
_FALLBACK_CATALOG = [
    {
        "id": "iss",
        "name": "国际空间站 ISS",
        "norad_id": 25544,
        "builtin": True,
    },
    {
        "id": "css",
        "name": "中国空间站 CSS",
        "norad_id": 48274,
        "builtin": True,
    },
]


def _load_catalog() -> list:
    """读取目录 JSON；缺失/损坏/结构异常时回退内置最小默认。"""
    try:
        data = json.loads(_CATALOG_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [s for s in data if isinstance(s, dict) and "norad_id" in s]
    except (OSError, ValueError):
        logger.warning("卫星目录读取失败，回退内置最小默认: %s", _CATALOG_FILE, exc_info=True)
    return [dict(s) for s in _FALLBACK_CATALOG]


CATALOG = _load_catalog()

# 内置卫星（不可删除）：UI 卫星列表种子
BUILTIN_SATELLITES = [
    {"id": s["id"], "name": s["name"], "norad_id": int(s["norad_id"]), "builtin": True}
    for s in CATALOG
    if s.get("builtin") and s.get("id")
]

# 离线兜底 TLE 表：按 norad_id 索引 {name, fallback}（供 provider 使用）
FALLBACK_SATELLITES = {
    int(s["norad_id"]): {"name": s["name"], "fallback": tuple(s["fallback"])}
    for s in CATALOG
    if s.get("fallback") and isinstance(s["fallback"], list) and len(s["fallback"]) == 3
}
