"""卫星数据文件管理 (lib) 单元与接口测试。

download_group 的网络层用 monkeypatch 替换 lib._http_get，保证离线、确定性；
数据文件目录重定向到临时目录，不污染真实运行时数据。
"""

import pytest
from fastapi.testclient import TestClient

import app as app_module
import lib
import provider
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
    # 精简后仅保留常用组（数量与是否排除已删组）
    assert len(all_groups) == 18
    removed = {"visual", "military", "radar", "engineering", "geodetic", "sarsat"}
    keys = {g["key"] for g in all_groups}
    assert keys.isdisjoint(removed)
    assert "stations" in keys and "amateur" in keys and "beidou" in keys
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


# ---- 详情(find_entry_by_norad / /api/library/detail)----
def test_find_entry_by_norad(monkeypatch):
    assert lib.find_entry_by_norad(24278) is None  # 尚未下载任何组
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: _FAKE_3LE)
    lib.download_group("amateur")  # 真实路径经隔离目录 + mock 后离线
    e = lib.find_entry_by_norad(24278)
    assert e is not None and "FO-29" in e["name"]
    assert e["norad_id"] == 24278
    assert lib.find_entry_by_norad(99999) is None


def test_library_detail_returns_orbit(monkeypatch):
    monkeypatch.setattr(lib, "_http_get", lambda url, timeout=20: _FAKE_3LE)
    client = TestClient(app_module.app)
    client.post("/api/library/download", json={"key": "amateur"})
    r = client.get("/api/library/detail", params={"norad_id": 24278})
    assert r.status_code == 200
    body = r.json()
    assert body["norad_id"] == 24278
    assert body["name"]
    assert "orbit" in body
    # 轨道根数含周期 / 倾角等
    assert "period_min" in body["orbit"]
    assert "inclination_deg" in body["orbit"]
    assert "tle1" in body and body["tle1"].startswith("1 24278")


def test_library_detail_not_found():
    client = TestClient(app_module.app)
    r = client.get("/api/library/detail", params={"norad_id": 99999})
    assert r.status_code == 404


# ---- 档案信息(get_satellite_info 缓存 / /api/library/info)----
def _fake_info_meta():
    return {
        "name": "OSCAR 7", "names": "AO-7, AMSAT OSCAR 7", "status": "in orbit",
        "launch_date": "1974-11-15T00:00:00Z", "operator": "AMSAT",
        "countries": "US", "website": "http://amsat.org", "telemetries": [],
        "image_url": "https://db.satnogs.org/media/satellites/AMSAT-OSCAR_7.jpg",
    }


def test_get_satellite_info_caches(monkeypatch):
    calls = {"n": 0}

    def fake_fetch(norad_id, timeout=20):
        calls["n"] += 1
        return _fake_info_meta()

    monkeypatch.setattr(provider, "fetch_satellite_info_online", fake_fetch)
    monkeypatch.setattr(
        store, "_get_amsat_freq_map",
        lambda: {"7530": [{"uplink": "145.85", "downlink": "29.4", "mode": "A"}]},
    )
    # 首次：联网拉取并写缓存
    info1 = lib.get_satellite_info(7530)
    assert info1 is not None
    assert calls["n"] == 1
    assert "AO-7" in info1["names"]
    assert info1["frequencies"][0]["uplink"] == "145.85"
    assert info1["fetched_at"]
    assert info1["image_url"] == "https://db.satnogs.org/media/satellites/AMSAT-OSCAR_7.jpg"
    # 再次：命中缓存，不再联网
    info2 = lib.get_satellite_info(7530)
    assert info2 is not None and calls["n"] == 1
    # 强制刷新：忽略缓存，重新联网
    info3 = lib.get_satellite_info(7530, refresh=True)
    assert info3 is not None and calls["n"] == 2


def test_get_satellite_info_not_found_not_cached(monkeypatch):
    monkeypatch.setattr(provider, "fetch_satellite_info_online", lambda norad_id, timeout=20: {})
    monkeypatch.setattr(store, "_get_amsat_freq_map", lambda: {})
    assert lib.get_satellite_info(424242) is None
    assert "424242" not in store._load_sat_info()  # 不缓存"查不到"的结果


def test_library_info_endpoint(monkeypatch):
    monkeypatch.setattr(provider, "fetch_satellite_info_online", lambda norad_id, timeout=20: _fake_info_meta())
    monkeypatch.setattr(store, "_get_amsat_freq_map", lambda: {"7530": [{"mode": "A"}]})
    client = TestClient(app_module.app)
    r = client.get("/api/library/info", params={"norad_id": 7530})
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True
    assert "AO-7" in body["names"]
    # 命中缓存后 found 仍为 True
    r2 = client.get("/api/library/info", params={"norad_id": 7530})
    assert r2.json()["found"] is True

    # 未收档 → found False
    monkeypatch.setattr(provider, "fetch_satellite_info_online", lambda norad_id, timeout=20: {})
    r3 = client.get("/api/library/info", params={"norad_id": 424242, "refresh": "true"})
    assert r3.status_code == 200 and r3.json()["found"] is False


# ---- 加入/移出已加入列表(activate / deactivate)----
def _activate_setup(monkeypatch):
    """mock 网络 + 下载一个 amateur 组(含 AO-7 7530，非内置星)，返回 client。"""
    monkeypatch.setattr(
        lib, "_http_get", lambda url, timeout=20:
        """OSCAR 7 (AO-7)
1 07530U 74089B   26238.93547522 -.00000023  00000+0  14709-3 0  9990
2 07530 101.9921 252.9218 0012226 358.1303 117.0601 12.53699297369383
"""
    )
    client = TestClient(app_module.app)
    client.post("/api/library/download", json={"key": "amateur"})
    return client


def test_library_activate(monkeypatch):
    client = _activate_setup(monkeypatch)
    r = client.post("/api/library/activate", json={"norad_id": 7530})
    assert r.status_code == 200
    body = r.json()
    assert body["satellite"]["norad_id"] == 7530
    assert any(int(s["norad_id"]) == 7530 for s in body["satellites"])
    # 二次激活 → 已在
    r2 = client.post("/api/library/activate", json={"norad_id": 7530})
    assert r2.status_code == 400
    # 库中不存在的星 → 404
    r3 = client.post("/api/library/activate", json={"norad_id": 999999})
    assert r3.status_code == 404


def test_library_activate_and_deactivate(monkeypatch):
    client = _activate_setup(monkeypatch)
    client.post("/api/library/activate", json={"norad_id": 7530})
    r = client.post("/api/library/deactivate", json={"id": str(7530)})
    assert r.status_code == 200
    assert all(int(s["norad_id"]) != 7530 for s in r.json()["satellites"])
    # 内置星不可删（iss 仍为内置）
    r2 = client.post("/api/library/deactivate", json={"id": "iss"})
    assert r2.status_code == 200
    assert any(s["id"] == "iss" for s in r2.json()["satellites"])


def test_library_deactivate_missing_id():
    client = TestClient(app_module.app)
    r = client.post("/api/library/deactivate", json={})
    assert r.status_code == 400
