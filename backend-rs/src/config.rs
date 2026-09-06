//! 轻量配置模块：对应 backend/config.py。
//!
//! 从 backend-rs/.env（若存在）读取环境变量，未配置时用代码内默认值。
//! 真实环境变量优先于 .env 文件（dotenvy 不覆盖已存在的环境变量）。
//!
//! 与 Python 后端共享同一份数据文件：
//!   CONFIG_DIR = <repo>/backend/config （settings.json / tles.json / satellite_info.json / satellites.json）
//!   DATA_DIR   = <repo>/backend/data   （satellite_files/）
//! 默认路径在编译期由 CARGO_MANIFEST_DIR 推导（backend-rs 的同级 backend），
//! 可用 GS_CONFIG_DIR / GS_DATA_DIR 覆盖以适配其它部署布局。
//!
//! 支持键：
//!   GS_HOST / GS_PORT                 服务监听地址与端口
//!   GS_DEFAULT_LAT/LON/ALT_M          默认地面站坐标
//!   GS_ON80DD_LAT/LON/ALT_M           内置 ON80DD 站点坐标
//!   GS_CONFIG_DIR / GS_DATA_DIR       运行时配置 / 数据目录
//!   GS_CORS_ORIGINS                   CORS 允许来源（逗号分隔；* 表示任意来源）

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// 编译期 backend-rs 目录，用于推导仓库内既有的 backend/config 与 backend/data。
const MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");

fn env_str(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_int(key: &str, default: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(default)
}

fn env_float(key: &str, default: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(default)
}

/// 加载 backend-rs/.env（存在则加载，不覆盖真实环境变量）。幂等，仅首次生效。
fn load_dotenv_once() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let env_file = Path::new(MANIFEST_DIR).join(".env");
        let _ = dotenvy::from_path(env_file);
    });
}

/// 默认 backend 目录：backend-rs 的同级 backend（仓库内既有 Python 后端目录）。
fn default_backend_dir() -> PathBuf {
    Path::new(MANIFEST_DIR)
        .parent()
        .map(|p| p.join("backend"))
        .unwrap_or_else(|| PathBuf::from("backend"))
}

/// 运行时配置目录（settings/tles/satellite_info/satellites.json）。
pub static CONFIG_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
    load_dotenv_once();
    let v = std::env::var("GS_CONFIG_DIR").ok();
    match v {
        Some(s) if !s.trim().is_empty() => PathBuf::from(s),
        _ => default_backend_dir().join("config"),
    }
});

/// 运行时数据目录（satellite_files 等下载留档文件）。
pub static DATA_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
    load_dotenv_once();
    let v = std::env::var("GS_DATA_DIR").ok();
    match v {
        Some(s) if !s.trim().is_empty() => PathBuf::from(s),
        _ => default_backend_dir().join("data"),
    }
});

/// 服务监听地址。
pub static HOST: LazyLock<String> = LazyLock::new(|| {
    load_dotenv_once();
    env_str("GS_HOST", "0.0.0.0")
});

/// 服务监听端口。
pub static PORT: LazyLock<i64> = LazyLock::new(|| {
    load_dotenv_once();
    env_int("GS_PORT", 8765)
});

/// 默认地面站坐标（首次启动 / 设置缺失时的回退）。
pub static DEFAULT_LAT: LazyLock<f64> =
    LazyLock::new(|| {
        load_dotenv_once();
        env_float("GS_DEFAULT_LAT", 39.9042)
    });
pub static DEFAULT_LON: LazyLock<f64> =
    LazyLock::new(|| {
        load_dotenv_once();
        env_float("GS_DEFAULT_LON", 116.4074)
    });
pub static DEFAULT_ALT_M: LazyLock<f64> =
    LazyLock::new(|| {
        load_dotenv_once();
        env_float("GS_DEFAULT_ALT_M", 44.0)
    });

/// 内置 ON80DD 站点坐标（Maidenhead 格网中心，北京西北）。
pub static ON80DD_LAT: LazyLock<f64> =
    LazyLock::new(|| {
        load_dotenv_once();
        env_float("GS_ON80DD_LAT", 40.1458)
    });
pub static ON80DD_LON: LazyLock<f64> =
    LazyLock::new(|| {
        load_dotenv_once();
        env_float("GS_ON80DD_LON", 116.2917)
    });
pub static ON80DD_ALT_M: LazyLock<f64> =
    LazyLock::new(|| {
        load_dotenv_once();
        env_float("GS_ON80DD_ALT_M", 44.0)
    });

/// CORS 允许来源（逗号分隔）；空则回退到 ["*"]。
pub static CORS_ORIGINS: LazyLock<Vec<String>> = LazyLock::new(|| {
    load_dotenv_once();
    parse_origins(&env_str("GS_CORS_ORIGINS", "*"))
});

/// 通配符来源 + 凭据不合规范：显式来源时允许凭据，通配符时关闭凭据。
pub static CORS_ALLOW_CREDENTIALS: LazyLock<bool> =
    LazyLock::new(|| !CORS_ORIGINS.iter().any(|o| o == "*"));

fn parse_origins(raw: &str) -> Vec<String> {
    let origins: Vec<String> = raw
        .split(',')
        .map(|o| o.trim().to_string())
        .filter(|o| !o.is_empty())
        .collect();
    if origins.is_empty() {
        vec!["*".to_string()]
    } else {
        origins
    }
}

/// 应用版本：单一来源为仓库根 VERSION 文件（与前端一致）。
pub static APP_VERSION: LazyLock<String> = LazyLock::new(|| {
    load_dotenv_once();
    let version_file = default_backend_dir().parent().map(|p| p.join("VERSION"));
    version_file
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "1.0.0".to_string())
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_origins_default_wildcard() {
        assert_eq!(parse_origins("*"), vec!["*"]);
        assert_eq!(parse_origins("  "), vec!["*"]);
    }

    #[test]
    fn parse_origins_list() {
        assert_eq!(
            parse_origins("http://a:1, http://b:2"),
            vec!["http://a:1".to_string(), "http://b:2".to_string()]
        );
    }
}
