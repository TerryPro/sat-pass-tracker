"""API 冒烟测试。

使用 fastapi.testclient 直连 ASGI 应用；数据文件重定向到临时目录、
TLE 固定为内置历史值，保证测试离线、确定且不污染真实运行时数据。
"""

import pytest
from fastapi.testclient import TestClient

import app as app_module
import store
import tle
from provider import _SATELLITES

# ISS 内置历史 TLE（离线、确定性）
_FALLBACK_TLE = _SATELLITES[25544]["fallback"]


@pytest.fixture(autouse=True)
def _isolate_data(tmp_path, monkeypatch):
    """把设置 / TLE / 卫星信息文件重定向到临时目录（持久化层 store 模块）。"""
    monkeypatch.setattr(store, "_SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(store, "_TLES_FILE", tmp_path / "tles.json")
    monkeypatch.setattr(store, "_SATINFO_FILE", tmp_path / "satellite_info.json")


@pytest.fixture(autouse=True)
def _offline_tle(monkeypatch):
    """所有 TLE 获取固定返回内置历史 TLE（tle 模块），不依赖网络。"""
    monkeypatch.setattr(tle, "_get_tle_cached", lambda norad_id=25544: _FALLBACK_TLE)
    # 测试环境下统一标记为历史兜底来源
    monkeypatch.setattr(tle, "tle_source", lambda norad_id: "fallback")


@pytest.fixture(scope="module")
def client():
    with TestClient(app_module.sio_app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_settings_defaults(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["satellite"] == "iss"
    assert "terminator_show_dashed" in body
    assert any(s["id"] == "beijing" for s in body["stations"])


def test_settings_roundtrip(client):
    before = client.get("/api/settings").json()
    payload = {"terminator_show_dashed": not before["terminator_show_dashed"]}
    r = client.post("/api/settings", json=payload)
    assert r.status_code == 200
    saved = r.json()
    assert saved["terminator_show_dashed"] is payload["terminator_show_dashed"]
    # 回写原值，保持后续断言一致（数据在 tmp 目录，无真实副作用）
    client.post("/api/settings", json={"terminator_show_dashed": before["terminator_show_dashed"]})


def test_passes_endpoint(client):
    r = client.get("/api/passes", params={"hours": 24, "sample_interval": 60})
    assert r.status_code == 200
    data = r.json()
    assert data["norad_id"] == 25544  # 默认卫星 iss
    assert data["tle_source"] == "fallback"
    assert isinstance(data["passes"], list)
    for p in data["passes"]:
        assert p["duration_sec"] > 0
        assert 0 <= p["max_elevation_deg"] <= 90
        assert len(p["samples"]) >= 2


def test_passes_horizon_mask(client):
    h0 = client.get("/api/passes", params={"hours": 48, "sample_interval": 300}).json()["passes"]
    h10 = client.get(
        "/api/passes", params={"hours": 48, "sample_interval": 300, "horizon": 10}
    ).json()["passes"]
    assert len(h10) <= len(h0)


def test_groundtrack_endpoint(client):
    r = client.get("/api/groundtrack", params={"hours": 6, "step_sec": 60})
    assert r.status_code == 200
    pts = r.json()["points"]
    assert r.json()["tle_source"] == "fallback"
    assert len(pts) > 2
    for pt in pts[:5]:
        assert -90 <= pt["lat"] <= 90
        assert -180 <= pt["lon"] <= 180


def test_satellites_list(client):
    r = client.get("/api/satellites")
    assert r.status_code == 200
    sats = r.json()["satellites"]
    assert any(s["id"] == "iss" for s in sats)
    assert any(s["id"] == "css" for s in sats)
    # FO-29 已非内置，默认已加入列表不应包含它
    assert not any(s["id"] == "fo29" for s in sats)


def test_cors_wildcard_default(client):
    """默认通配符来源：任意来源的预检/普通请求都放行，且不携带凭据（通配符自动关闭凭据）。"""
    r = client.options(
        "/api/settings",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"
    assert "access-control-allow-credentials" not in r.headers

    r = client.get("/api/health", headers={"Origin": "http://evil.example"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"


def test_cors_restricted_origins():
    """显式来源配置（参数同 app.py 中间件）：未列入的来源被拒绝且不携带 Allow-Origin 头。"""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.testclient import TestClient

    app2 = FastAPI()
    app2.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app2.get("/api/health")
    def h():
        return {"status": "ok"}

    c = TestClient(app2)
    # 未列入来源：预检拒绝
    r = c.options(
        "/api/health",
        headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers
    # 列入来源：放行并携带凭据
    r2 = c.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert r2.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert r2.headers.get("access-control-allow-credentials") == "true"
