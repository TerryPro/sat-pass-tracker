"""
轻量配置模块：从 backend/.env（若存在）读取环境变量，未配置时用代码内默认值。

不引入第三方依赖（Python 自带 os/Path 即可）。真实环境变量优先于 .env 文件。
支持键：
    GS_HOST / GS_PORT                 服务监听地址与端口
    GS_DEFAULT_LAT/LON/ALT_M         默认地面站坐标（设置缺失时的回退）
    GS_ON80DD_LAT/LON/ALT_M          内置 ON80DD 站点坐标
    GS_DATA_DIR                      运行时数据目录（settings.json 等）
    GS_CORS_ORIGINS                  CORS 允许来源（逗号分隔；* 表示任意来源）
"""

from __future__ import annotations

import os
from pathlib import Path

# backend/.env 与本文件同目录；存在则加载（不覆盖已设置的真实环境变量）
_ENV_FILE = Path(__file__).resolve().parent / ".env"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(_ENV_FILE)


def get(key: str, default: str) -> str:
    return os.environ.get(key, default)


def get_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


def get_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------
# 服务监听
# ---------------------------------------------------------------
HOST = get("GS_HOST", "0.0.0.0")
PORT = get_int("GS_PORT", 8765)

# ---------------------------------------------------------------
# 默认地面站坐标（首次启动 / 设置缺失时的回退）
# ---------------------------------------------------------------
DEFAULT_LAT = get_float("GS_DEFAULT_LAT", 39.9042)
DEFAULT_LON = get_float("GS_DEFAULT_LON", 116.4074)
DEFAULT_ALT_M = get_float("GS_DEFAULT_ALT_M", 44.0)

# ---------------------------------------------------------------
# 内置 ON80DD 站点坐标（Maidenhead 格网中心，北京西北）
# ---------------------------------------------------------------
ON80DD_LAT = get_float("GS_ON80DD_LAT", 40.1458)
ON80DD_LON = get_float("GS_ON80DD_LON", 116.2917)
ON80DD_ALT_M = get_float("GS_ON80DD_ALT_M", 44.0)

# ---------------------------------------------------------------
# 卫星数据文件下载目录（satellite_files；settings/TLE/卫星信息 JSON 固定位于 backend/config/）
# ---------------------------------------------------------------
DATA_DIR = Path(get("GS_DATA_DIR", str(Path(__file__).resolve().parent / "data")))

# ---------------------------------------------------------------
# CORS 允许来源（FastAPI 中间件与 Socket.IO 共用）
# 逗号分隔的显式来源列表；* 表示任意来源。
# 本地开发走 Vite 同源代理，且常需用局域网地址（手机/平板）预览，
# 因此默认放行任意来源；部署到公网时通过 GS_CORS_ORIGINS
# 显式列出前端实际来源，避免"通配符来源 + 携带凭据"的不合规组合。
# ---------------------------------------------------------------
def _parse_origins(raw: str) -> list:
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or ["*"]


CORS_ORIGINS = _parse_origins(get("GS_CORS_ORIGINS", "*"))
# 通配符来源 + 凭据不合规范：显式来源时允许凭据，通配符时自动关闭凭据
CORS_ALLOW_CREDENTIALS = "*" not in CORS_ORIGINS


# ---------------------------------------------------------------
# 应用版本：单一来源为仓库根 VERSION 文件（前端同样读取它显示）
# ---------------------------------------------------------------
VERSION = Path(__file__).resolve().parent.parent / "VERSION"
try:
    APP_VERSION = VERSION.read_text(encoding="utf-8").strip() or "1.0.0"
except OSError:
    APP_VERSION = "1.0.0"
