"""
用户设置 REST 接口：读取 / 保存（JSON 文件持久化）。
"""

from __future__ import annotations

from fastapi import APIRouter

from store import _load_settings, _save_settings  # noqa: E402

router = APIRouter()


@router.get("/api/settings")
async def api_get_settings():
    """读取持久化用户设置（坐标 / 默认卫星 / 时长 / 采样间隔）。"""
    return _load_settings()


@router.post("/api/settings")
async def api_save_settings(payload: dict):
    """保存用户设置到 JSON 文件，返回合并后的完整设置。

    异常由全局异常处理器统一转换（500 → {"error": ...}）。
    """
    return _save_settings(payload)
