"""过境计算核心逻辑测试。

全部使用内置历史 TLE（离线、确定性），不访问网络。
"""

from datetime import datetime

import pytest

import astro as astro_mod
from astro import (
    MAX_SAMPLES_PER_PASS,
    _sampling_plan,
    compute_current_position,
    compute_groundtrack,
    compute_passes,
)
from provider import _SATELLITES

FO29_TLE = _SATELLITES[24278]["fallback"]
BEIJING = {"lat": 39.9042, "lon": 116.4074, "alt_m": 44.0}


def _compute(hours=48, horizon=0.0, sample_interval=30):
    name, tle1, tle2 = FO29_TLE
    return compute_passes(
        tle_name=name,
        tle1=tle1,
        tle2=tle2,
        lat=BEIJING["lat"],
        lon=BEIJING["lon"],
        alt_m=BEIJING["alt_m"],
        hours=hours,
        horizon_deg=horizon,
        sample_interval_sec=sample_interval,
    )


def test_passes_nonempty_and_ordered():
    passes, _ = _compute()
    assert passes, "48 小时内应至少有一次 FO-29 过境"
    aos = [datetime.fromisoformat(p.aos) for p in passes]
    los = [datetime.fromisoformat(p.los) for p in passes]
    assert aos == sorted(aos), "过境应按 AOS 时间升序"
    for i in range(1, len(passes)):
        assert aos[i] >= los[i - 1], "相邻过境不应重叠"


def test_pass_fields():
    passes, _ = _compute()
    for p in passes:
        assert p.duration_sec > 0
        assert 0.0 <= p.max_elevation_deg <= 90.0
        assert len(p.samples) >= 2
        aos = datetime.fromisoformat(p.aos)
        los = datetime.fromisoformat(p.los)
        for s in p.samples:
            t = datetime.fromisoformat(s.t)
            assert aos <= t <= los, "采样点时刻应落在 [AOS, LOS] 内"
            assert 0.0 <= s.az <= 360.0
            assert -90.0 <= s.el <= 90.0
            assert s.r_km > 0


def test_horizon_mask_reduces_or_equal():
    """更高的地平线掩码不应产生更多过境（子集关系）。"""
    low, _ = _compute(horizon=0.0, sample_interval=300)
    high, _ = _compute(horizon=10.0, sample_interval=300)
    assert len(high) <= len(low)


def test_groundtrack_shape():
    name, tle1, tle2 = FO29_TLE
    pts = compute_groundtrack(
        tle_name=name,
        tle1=tle1,
        tle2=tle2,
        lat=BEIJING["lat"],
        lon=BEIJING["lon"],
        alt_m=BEIJING["alt_m"],
        hours=6,
        step_sec=60,
    )
    assert len(pts) >= 100, "6 小时、每 60s 一点应有足够多的轨迹点"
    assert len({p.orbit for p in pts}) >= 1
    for p in pts:
        assert -90 <= p.lat <= 90
        assert -180 <= p.lon <= 180
        assert -90 <= p.el <= 90
        assert p.r_km > 0


def test_current_position_fields():
    name, tle1, tle2 = FO29_TLE
    pos = compute_current_position(tle1, tle2, BEIJING["lat"], BEIJING["lon"], BEIJING["alt_m"])
    assert pos is not None
    for key in ("t", "az", "el", "r_km", "lat", "lon", "alt_km"):
        assert key in pos
    assert pos["r_km"] > 0


def test_sampling_plan_caps_long_passes():
    """长过境 + 密采样自动放大间隔，样本数不超过上限且覆盖全程。"""
    # 14 天 GEO 过境 + 1s 采样（原实现会产生 120 万采样点）
    n, step = _sampling_plan(14 * 86400, 1)
    assert n <= MAX_SAMPLES_PER_PASS
    assert step > 1
    assert 14 * 86400 // step == n  # 样本仍覆盖全程
    # 常规 LEO 过境不受影响
    n2, step2 = _sampling_plan(600, 60)
    assert (n2, step2) == (10, 60)
    # 恰好等于上限时不放大
    n3, step3 = _sampling_plan(MAX_SAMPLES_PER_PASS, 1)
    assert step3 == 1


def test_total_sample_cap(monkeypatch):
    """累计采样点超上限时报错（防止超大 JSON 响应卡死前端）。"""
    monkeypatch.setattr(astro_mod, "MAX_TOTAL_SAMPLES", 50)
    with pytest.raises(ValueError):
        _compute_passes_raw(hours=48, sample_interval_sec=1)


def test_groundtrack_point_cap(monkeypatch):
    """星下点轨迹点数超上限时自动放大步长。"""
    monkeypatch.setattr(astro_mod, "MAX_GROUNDTRACK_POINTS", 100)
    name, tle1, tle2 = FO29_TLE
    pts = compute_groundtrack(
        tle_name=name, tle1=tle1, tle2=tle2,
        lat=BEIJING["lat"], lon=BEIJING["lon"], alt_m=BEIJING["alt_m"],
        hours=336, step_sec=10,
    )
    assert 0 < len(pts) <= 101  # 上限 100 + 末尾补点


def _compute_passes_raw(hours=48, sample_interval_sec=60):
    """直接调用 compute_passes（供总量保护测试用）。"""
    name, tle1, tle2 = FO29_TLE
    return compute_passes(
        tle_name=name, tle1=tle1, tle2=tle2,
        lat=BEIJING["lat"], lon=BEIJING["lon"], alt_m=BEIJING["alt_m"],
        hours=hours, horizon_deg=0.0, sample_interval_sec=sample_interval_sec,
    )


def test_invalid_tle_no_crash():
    """无效 TLE 不应崩溃：compute_passes 返回 (passes, satellite)，passes 为 list。"""
    passes, sat = compute_passes(
        tle_name="BAD", tle1="garbage", tle2="garbage",
        lat=BEIJING["lat"], lon=BEIJING["lon"], alt_m=BEIJING["alt_m"],
        hours=24, horizon_deg=0.0, sample_interval_sec=60,
    )
    assert isinstance(passes, list)


def test_current_position_invalid_tle_returns_none():
    """实时位置计算对无效 TLE 返回 None（内部捕获异常，不向上抛）。"""
    pos = compute_current_position(
        "garbage", "garbage", BEIJING["lat"], BEIJING["lon"], BEIJING["alt_m"]
    )
    assert pos is None


def test_groundtrack_step_clamped_to_min():
    """过小步长不应产生过量点数（点数上限保护自动放大步长）。"""
    name, tle1, tle2 = FO29_TLE
    pts = compute_groundtrack(
        tle_name=name, tle1=tle1, tle2=tle2,
        lat=BEIJING["lat"], lon=BEIJING["lon"], alt_m=BEIJING["alt_m"],
        hours=48, step_sec=1,
    )
    assert 0 < len(pts) <= 20000
    # 圈号单调递增，且相邻点经度不出现 ±180 跳变导致的混乱
    orbits = [p.orbit for p in pts]
    assert orbits == sorted(orbits)
