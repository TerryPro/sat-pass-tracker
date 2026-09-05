"""业务编排层 passservice 测试：参数 clamp、预设解析、全局状态更新。

数据文件重定向到临时目录、TLE 固定为内置历史值，保证离线、确定且隔离。
"""

import pytest

import config
import passservice
import state
import store
import tle
from provider import _SATELLITES

_FALLBACK_TLE = _SATELLITES[25544]["fallback"]


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """隔离持久化文件、TLE 与运行时状态，避免用例间相互影响。"""
    monkeypatch.setattr(store, "_SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(store, "_TLES_FILE", tmp_path / "tles.json")
    monkeypatch.setattr(store, "_SATINFO_FILE", tmp_path / "satellite_info.json")
    monkeypatch.setattr(tle, "_get_tle_cached", lambda norad_id=25544: _FALLBACK_TLE)
    monkeypatch.setattr(tle, "tle_source", lambda norad_id: "fallback")
    state._state.clear()
    state._state.update({"station": None, "output": None, "current_satellite": None})


def _passes_params(**overrides):
    """构造 /api/passes 同构参数，可覆盖任意字段。"""
    params = {
        "lat": config.DEFAULT_LAT,
        "lon": config.DEFAULT_LON,
        "alt": config.DEFAULT_ALT_M,
        "hours": 24,
        "sample_interval": 60,
        "horizon": 0.0,
        "preset": "",
        "satellite": "iss",
    }
    params.update(overrides)
    return params


def test_hours_clamped_to_max():
    out = passservice.compute_passes_service(_passes_params(hours=9999))
    assert out["hours"] == 24 * 14  # 最多 14 天


def test_hours_clamped_to_min():
    out = passservice.compute_passes_service(_passes_params(hours=0))
    assert out["hours"] == 1


def test_sample_interval_clamped():
    out = passservice.compute_passes_service(_passes_params(sample_interval=99999))
    assert out["sample_interval_sec"] == 600
    out2 = passservice.compute_passes_service(_passes_params(sample_interval=0))
    assert out2["sample_interval_sec"] == 1


def test_preset_on80dd():
    out = passservice.compute_passes_service(_passes_params(preset="on80dd"))
    assert out["station_label"] == "ON80DD"
    assert out["station_lat"] == pytest.approx(config.ON80DD_LAT, abs=1e-4)
    assert out["station_lon"] == pytest.approx(config.ON80DD_LON, abs=1e-4)


def test_preset_beijing():
    out = passservice.compute_passes_service(_passes_params(preset="beijing"))
    assert out["station_label"] == "Beijing"
    assert out["station_lat"] == pytest.approx(config.DEFAULT_LAT)


def test_custom_station_label():
    out = passservice.compute_passes_service(
        _passes_params(lat=10.0, lon=20.0, preset="")
    )
    assert out["station_label"] == "10.000, 20.000"


def test_state_updated_after_compute():
    passservice.compute_passes_service(_passes_params())
    st = state._state
    assert st["station"]["satellite"] == "iss"
    assert st["station"]["norad_id"] == 25544
    assert st["station"]["hours"] == 24
    assert st["current_satellite"] == "iss"
    assert st["output"]["norad_id"] == 25544
    assert st["output"]["tle_source"] == "fallback"


def test_groundtrack_clamp():
    out = passservice.compute_groundtrack_service(
        {"hours": 9999, "step_sec": 1, "preset": "", "satellite": "iss"}
    )
    assert out["hours"] == 24 * 14
    assert out["step_sec"] == 10
    assert out["norad_id"] == 25544
