"""持久化层 store 测试：原子写、损坏文件回退、列表规范化。

所有文件重定向到临时目录，不污染真实运行时数据。
"""

import pytest

import store


@pytest.fixture(autouse=True)
def _isolate_files(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(store, "_TLES_FILE", tmp_path / "tles.json")
    monkeypatch.setattr(store, "_SATINFO_FILE", tmp_path / "satellite_info.json")
    monkeypatch.setattr(store, "SATELLITE_FILES_DIR", tmp_path / "satellite_files")


def test_save_settings_roundtrip():
    store._save_settings({"theme": "light"})
    saved = store._load_settings()
    assert saved["theme"] == "light"
    # 内置站点 / 卫星始终保留
    assert any(s["id"] == "beijing" for s in saved["stations"])
    assert any(s["id"] == "iss" for s in saved["satellites"])


def test_save_tle_roundtrip():
    store._save_tle(24278, "FO-29", "L1", "L2", 123.0, source="online")
    tles = store._load_tles()
    assert tles["24278"]["tle1"] == "L1"
    assert tles["24278"]["source"] == "online"


def test_save_sat_info_roundtrip():
    store._save_sat_info(24278, {"description": "x"}, 123.0)
    infos = store._load_sat_info()
    assert infos["24278"]["description"] == "x"
    assert infos["24278"]["fetched_ts"] == 123.0


def test_atomic_write_leaves_no_temp(tmp_path, monkeypatch):
    """原子写后不应残留 .tmp 临时文件。"""
    monkeypatch.setattr(store, "_SETTINGS_FILE", tmp_path / "settings.json")
    store._save_settings({"theme": "dark"})
    assert [p for p in tmp_path.iterdir() if p.suffix == ".tmp"] == []


def test_atomic_write_replaces_content(tmp_path, monkeypatch):
    """连续保存两次，最终内容为最后一次，且 JSON 完整可解析。"""
    monkeypatch.setattr(store, "_SETTINGS_FILE", tmp_path / "settings.json")
    store._save_settings({"theme": "dark"})
    store._save_settings({"theme": "light"})
    saved = store._load_settings()
    assert saved["theme"] == "light"


def test_corrupt_settings_falls_back_to_defaults():
    store._SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    store._SETTINGS_FILE.write_text("{not-json", encoding="utf-8")
    saved = store._load_settings()
    assert saved["theme"] == "dark"  # 回退默认值
    assert any(s["id"] == "iss" for s in saved["satellites"])


def test_corrupt_tles_falls_back_to_empty():
    store._TLES_FILE.parent.mkdir(parents=True, exist_ok=True)
    store._TLES_FILE.write_text("[]", encoding="utf-8")
    assert store._load_tles() == {}


def test_normalize_stations_dedup_and_coerce():
    raw = [
        {"id": "on80dd", "lat": 1, "lon": 2, "alt": 0},  # 内置 id 忽略
        {"id": "custom", "lat": "12.5", "lon": "34.5", "alt": "10"},
        {"id": "custom", "lat": 9, "lon": 9, "alt": 9},  # 重复 id 去重
        {"id": "bad"},  # 缺坐标跳过
    ]
    merged = store._normalize_stations(raw)
    ids = {s["id"] for s in merged}
    assert ids == {"on80dd", "beijing", "custom"}
    custom = next(s for s in merged if s["id"] == "custom")
    assert custom["lat"] == pytest.approx(12.5)
    assert custom["alt"] == pytest.approx(10.0)


def test_normalize_satellites_dedup_by_norad():
    raw = [
        {"id": "dup", "norad_id": 24278},  # 普通星(FO-29 已非内置)，保留
        {"id": "noaa15", "norad_id": 25338},
        {"id": "noaa15", "norad_id": 25338},  # 重复 id + norad → 去重
    ]
    merged = store._normalize_satellites(raw)
    ids = {s["id"] for s in merged}
    assert "dup" in ids
    assert ids == {"iss", "css", "dup", "noaa15"}
