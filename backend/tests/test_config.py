"""配置模块测试：默认值、环境变量覆盖、非法值回退。

注意：config 在导入时读取环境变量，因此用 importlib.reload 模拟重新加载；
每个用例结束后自动 reload 回默认值，避免影响其它测试。
"""

import importlib

import pytest

import config


@pytest.fixture(autouse=True)
def _restore_config_defaults():
    yield
    importlib.reload(config)  # 环境变量已被 monkeypatch 还原，reload 即恢复默认值


def test_defaults():
    assert config.HOST == "0.0.0.0"
    assert config.PORT == 8765
    assert config.DEFAULT_LAT == pytest.approx(39.9042)
    assert config.DEFAULT_LON == pytest.approx(116.4074)
    assert config.DEFAULT_ALT_M == pytest.approx(44.0)
    assert config.ON80DD_LAT == pytest.approx(40.1458)
    assert config.DATA_DIR.name == "data"


def test_env_override_int(monkeypatch):
    monkeypatch.setenv("GS_PORT", "9999")
    assert importlib.reload(config).PORT == 9999


def test_env_override_float(monkeypatch):
    monkeypatch.setenv("GS_DEFAULT_LAT", "10.5")
    assert importlib.reload(config).DEFAULT_LAT == pytest.approx(10.5)


def test_env_override_host(monkeypatch):
    monkeypatch.setenv("GS_HOST", "127.0.0.1")
    assert importlib.reload(config).HOST == "127.0.0.1"


def test_invalid_int_falls_back(monkeypatch):
    monkeypatch.setenv("GS_PORT", "abc")
    assert importlib.reload(config).PORT == 8765


def test_cors_origins_default():
    """默认任意来源（本地/局域网预览）；通配符来源时自动关闭携带凭据。"""
    assert config.CORS_ORIGINS == ["*"]
    assert config.CORS_ALLOW_CREDENTIALS is False


def test_cors_origins_env_override(monkeypatch):
    monkeypatch.setenv("GS_CORS_ORIGINS", "http://a.example, http://b.example")
    reloaded = importlib.reload(config)
    assert reloaded.CORS_ORIGINS == ["http://a.example", "http://b.example"]
    assert reloaded.CORS_ALLOW_CREDENTIALS is True


def test_cors_wildcard_disables_credentials(monkeypatch):
    monkeypatch.setenv("GS_CORS_ORIGINS", "*")
    reloaded = importlib.reload(config)
    assert reloaded.CORS_ORIGINS == ["*"]
    assert reloaded.CORS_ALLOW_CREDENTIALS is False
