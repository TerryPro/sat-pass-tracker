"""TLE 来源追踪测试：联网成功=online，在线失败回退=fallback，本地缓存=cache。"""

import pytest

import store
import tle
from provider import _SATELLITES


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    """隔离持久化文件与内存缓存，避免用例间相互影响。

    settings.json 也需隔离：否则会读到真实 settings.json 的 tle_mode=builtin，
    使 _get_tle_cached 走离线分支，来源标记变成 builtin 而非 online/fallback。
    """
    monkeypatch.setattr(store, "_TLES_FILE", tmp_path / "tles.json")
    monkeypatch.setattr(store, "_SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(tle, "_tle_cache", {})
    monkeypatch.setattr(tle, "_tle_source", {})


def _fallback_tle():
    return (*_SATELLITES[25544]["fallback"], True)


def _online_tle():
    name, l1, l2 = _SATELLITES[25544]["fallback"]
    return (name, l1, l2, False)


def test_online_source(monkeypatch):
    monkeypatch.setattr(tle, "fetch_latest_tle", lambda norad_id=25544: _online_tle())
    tle._get_tle_cached(25544)
    assert tle.tle_source(25544) == "online"


def test_fallback_source(monkeypatch):
    monkeypatch.setattr(tle, "fetch_latest_tle", lambda norad_id=25544: _fallback_tle())
    tle._get_tle_cached(25544)
    assert tle.tle_source(25544) == "fallback"


def test_file_cache_source(monkeypatch):
    """重启后从持久化文件恢复来源；旧数据无 source 字段视为 cache。"""
    monkeypatch.setattr(tle, "fetch_latest_tle", lambda norad_id=25544: _fallback_tle())
    tle._get_tle_cached(25544)  # 写入文件（source=fallback）
    # 模拟重启：清空内存缓存与来源
    tle._tle_cache.clear()
    tle._tle_source.clear()
    monkeypatch.setattr(tle, "fetch_latest_tle", lambda norad_id=25544: _online_tle())
    # 文件 12h 内有效 → 走本地缓存不联网，来源从文件读出
    tle._get_tle_cached(25544)
    assert tle.tle_source(25544) == "fallback"


def test_legacy_cache_defaults_to_cache(monkeypatch):
    """旧版 tles.json（无 source 字段）读取为 cache。"""
    monkeypatch.setattr(tle, "fetch_latest_tle", lambda norad_id=25544: _online_tle())
    # 直接写入无 source 字段的旧格式文件
    store._load_tles()
    import json

    store._TLES_FILE.parent.mkdir(parents=True, exist_ok=True)
    name, l1, l2 = _SATELLITES[25544]["fallback"]
    store._TLES_FILE.write_text(
        json.dumps({str(25544): {"name": name, "tle1": l1, "tle2": l2, "fetched_ts": __import__("time").time()}}),
        encoding="utf-8",
    )
    tle._get_tle_cached(25544)
    assert tle.tle_source(25544) == "cache"
