"""卫星数据文件管理 (lib) 单元与接口测试。

download_group 的网络层用 monkeypatch 替换 lib._http_get，保证离线、确定性；
数据文件目录重定向到临时目录，不污染真实运行时数据。
"""

import pytest
from fastapi.testclient import TestClient

import app as app_module
import lib
import store


# 一段假的 CelesTrak 3LE 组文件文本（两行 TLE 头行合法）
_FAKE_3LE = """FO-29 (JAS-2)
1 24278U 96046B   26223.09493086 -.00000008  00000-0  30637-4 0  9994
2 24278  98.5199  64.4403 0349059 314.0923  43.1968 13.5327675048059
ISS (ZARYA)
1 25544U 98067A   26224.50000000  .00000000  00000-0  00000-0 0  9999
2 25544  51.6416  89.5000 0005000  90.0000  270.0000 15.50995500    00
"""


@pytest.fixture(autouse=True)
def _isolate_files_dir(tmp_path, monkeypatch):
    # 卫星数据文件目录重定向到临时目录；其余运行时数据文件也一并隔离
    monkeypatch.setattr(store, "SATELLITE_FILES_DIR", tmp_path / "satellite_files")
    monkeypatch.setattr(store, "_SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(store, "_TLES_FILE", tmp_path / "tles.json")
    monkeypatch.setattr(store, "_SATINFO_FILE", tmp_path / "satellite_info.json")


# ---- 单元：parse_3le / group_count ----
def test_parse_3le_basic():
    parsed = lib.parse_3le(_FAKE_3LE)
    assert len(parsed) == 2
    assert parsed[0]["norad_id"] == 24278
    assert "FO-29" in parsed[0]["name"]
    assert parsed[0]["tle1"].startswith("1 24278")
    assert parsed[1]["norad_id"] == 25544


def test_parse_3le_tolerates_junk():
    body = "Noise\n\n" + _FAKE_3LE + "\n1 2 3 4\n"
    assert lib.group_count(body) == 2


# ---- 单元：download_group 落文件（mock 网络）----
def test_download_group_writes_raw_file(monkeypatch):
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: _FAKE_3LE)
    result = lib.download_group("amateur")
    assert result is not None
    assert result["count"] == 2
    path = store.SATELLITE_FILES_DIR / "amateur.tle"
    assert path.exists()
    # 写的是原始文本（不入库）
    assert "FO-29 (JAS-2)" in path.read_text(encoding="utf-8")


def test_download_group_overwrites_same_group(monkeypatch):
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: _FAKE_3LE)
    assert lib.download_group("amateur") is not None
    # 再次下载同组：写文件仍成功，文件内容更新
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: _FAKE_3LE)
    r = lib.download_group("amateur")
    assert r is not None and r["count"] == 2
    assert (store.SATELLITE_FILES_DIR / "amateur.tle").exists()


def test_download_group_unknown_returns_none():
    assert lib.download_group("no_such_group") is None


def test_download_group_fetch_failure_keeps_no_file(monkeypatch):
    """下载失败时不应留下空文件。"""
    path = store.SATELLITE_FILES_DIR / "weather.tle"
    assert not path.exists()
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: (_ for _ in ()).throw(RuntimeError("net down")))
    assert lib.download_group("weather") is None
    assert not path.exists()


# ---- 单元：list_downloaded / read_group_entries ----
def test_list_downloaded_and_read(monkeypatch):
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: _FAKE_3LE)
    lib.download_group("amateur")
    dl = lib.list_downloaded()
    assert len(dl) == 1
    assert dl[0]["key"] == "amateur"
    assert dl[0]["count"] == 2
    assert dl[0]["size"] > 0

    entries = lib.read_group_entries("amateur")
    assert entries is not None and len(entries) == 2
    assert entries[0]["source"] == "amateur"
    assert "tle_fetched_at" in entries[0]

    assert lib.read_group_entries("no_such") is None


def test_list_all_entries_merges(monkeypatch):
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: _FAKE_3LE)
    lib.download_group("amateur")
    lib.download_group("weather")
    assert len(lib.list_all_entries()) == 4


# ---- 接口 ----
def test_library_meta_empty():
    client = TestClient(app_module.app)
    r = client.get("/api/library/meta")
    assert r.status_code == 200
    body = r.json()
    # 平铺 groups 与分类 categories 均返回
    assert all(g["downloaded"] is False for g in body["groups"])
    assert body["total_entries"] == 0
    # 分类树：6 大类，每组都含 downloaded 状态
    assert len(body["categories"]) == 6
    assert all("groups" in c for c in body["categories"])
    all_groups = [g for c in body["categories"] for g in c["groups"]]
    assert len(all_groups) >= 20  # 常用组总数
    assert all("downloaded" in g and "label" in g for g in all_groups)
    # 平铺 groups 的数量与分类中组总数一致
    assert len(body["groups"]) == len(all_groups)


def test_library_download_and_entries(monkeypatch):
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: _FAKE_3LE)
    client = TestClient(app_module.app)
    r = client.post("/api/library/download", json={"key": "amateur"})
    assert r.status_code == 200
    assert r.json()["count"] == 2
    # 实际落盘为原始文件
    assert (store.SATELLITE_FILES_DIR / "amateur.tle").exists()

    r = client.get("/api/library/entries")
    assert r.status_code == 200
    assert r.json()["count"] == 2

    r = client.get("/api/library/entries", params={"q": "ISS"})
    assert r.json()["count"] == 1

    r = client.get("/api/library/entries", params={"q": "24278"})
    assert r.json()["count"] == 1
    assert r.json()["entries"][0]["norad_id"] == 24278

    r = client.get("/api/library/entries", params={"source": "amateur"})
    assert r.json()["count"] == 2
    r = client.get("/api/library/entries", params={"source": "weather"})
    assert r.json()["count"] == 0


def test_library_download_unknown_key_returns_400():
    client = TestClient(app_module.app)
    r = client.post("/api/library/download", json={"key": "nope"})
    assert r.status_code == 400
