//! 业务编排层：对应 backend/passservice.py。
//!
//! 参数解析 / 范围校验 / 过境计算 / 全局状态更新。路由层只负责 HTTP 参数绑定；
//! 具体业务流程（站点预设解析、clamp、TLE 获取、计算、写 state 供实时广播）收敛到这里。
//! 计算为 CPU 密集，放到 `spawn_blocking` 执行（对齐 Python 由 FastAPI 线程池运行同步 handler）。

use chrono::Utc;
use serde_json::{Value, json};

use crate::astroconv::iso_utc;
use crate::config;
use crate::error::ApiError;
use crate::models::{GroundTrackResponse, PassesResponse};
use crate::{astro, state, tle};

pub const MAX_HOURS: i64 = 24 * 14; // 最多 14 天
pub const MIN_SAMPLE_SEC: i64 = 1;
pub const MAX_SAMPLE_SEC: i64 = 600;
pub const MIN_STEP_SEC: i64 = 10;
pub const MAX_STEP_SEC: i64 = 600;

fn clamp(value: f64, lo: f64, hi: f64) -> f64 {
    value.max(lo).min(hi)
}

fn num(params: &Value, key: &str, default: f64) -> f64 {
    params.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
}

/// 解析地面站坐标与内置预设（preset），返回 (lat, lon, alt, label)。
fn resolve_station(params: &Value) -> (f64, f64, f64, String) {
    let mut lat = clamp(num(params, "lat", *config::DEFAULT_LAT), -90.0, 90.0);
    let mut lon = clamp(num(params, "lon", *config::DEFAULT_LON), -180.0, 180.0);
    let mut alt = clamp(num(params, "alt", *config::DEFAULT_ALT_M), 0.0, 10000.0);
    let preset = params
        .get("preset")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let label;
    if preset == "on80dd" {
        lat = *config::ON80DD_LAT;
        lon = *config::ON80DD_LON;
        alt = *config::ON80DD_ALT_M;
        label = "ON80DD".to_string();
    } else if preset == "beijing" || preset == "bj" {
        lat = *config::DEFAULT_LAT;
        lon = *config::DEFAULT_LON;
        alt = *config::DEFAULT_ALT_M;
        label = "Beijing".to_string();
    } else {
        label = format!("{:.3}, {:.3}", lat, lon);
    }
    (lat, lon, alt, label)
}

/// 把计算/TLE 错误映射为通用 500（对齐 Python 未处理异常的兜底行为），并记录详情。
fn internal_err(context: &str, err: String) -> ApiError {
    tracing::error!("{}: {}", context, err);
    ApiError::service("服务器内部错误")
}

/// 过境业务编排：解析参数 → clamp 校验 → 计算 → 更新 state → 返回响应。
pub async fn compute_passes_service(params: Value) -> Result<PassesResponse, ApiError> {
    let (lat, lon, alt, label) = resolve_station(&params);
    let hours = clamp(num(&params, "hours", 48.0), 1.0, MAX_HOURS as f64) as i64;
    let sample_sec = clamp(
        num(&params, "sample_interval", 30.0),
        MIN_SAMPLE_SEC as f64,
        MAX_SAMPLE_SEC as f64,
    ) as i64;
    let horizon = clamp(num(&params, "horizon", 0.0), -90.0, 90.0);
    let (sat_key, norad_id) = tle::resolve_satellite(&params);

    let (tle_name, tle1, tle2) = tle::get_tle_cached(norad_id)
        .await
        .map_err(|e| internal_err("获取 TLE 失败", e))?;

    // CPU 密集计算放到阻塞线程池，避免卡住事件循环
    let c_name = tle_name.clone();
    let c_l1 = tle1.clone();
    let c_l2 = tle2.clone();
    let passes = tokio::task::spawn_blocking(move || {
        astro::compute_passes(&c_name, &c_l1, &c_l2, lat, lon, alt, hours, horizon, sample_sec)
    })
    .await
    .map_err(|e| internal_err("计算任务失败", e.to_string()))?
    .map_err(|e| internal_err("过境计算失败", e))?;

    let epoch = tle::parse_tle_epoch(&tle1)
        .map(|d| iso_utc(&d))
        .unwrap_or_default();
    let source = tle::tle_source(norad_id);

    let output = PassesResponse {
        satellite_name: tle_name.clone(),
        norad_id,
        tle_name: tle_name.clone(),
        tle1: tle1.clone(),
        tle2: tle2.clone(),
        tle_epoch: epoch,
        station_lat: astro::round(lat, 6),
        station_lon: astro::round(lon, 6),
        station_alt_m: astro::round(alt, 2),
        station_label: label.clone(),
        generated_at: iso_utc(&Utc::now()),
        horizon_deg: horizon,
        hours,
        sample_interval_sec: sample_sec,
        tle_source: source,
        passes,
    };

    // 写入运行时状态，供 Socket.IO 实时位置广播只读使用
    let station_state = json!({
        "lat": lat, "lon": lon, "alt": alt, "label": label,
        "hours": hours, "sample_interval": sample_sec, "horizon": horizon,
        "satellite": sat_key.clone(), "norad_id": norad_id,
    });
    let output_value = serde_json::to_value(&output).unwrap_or_else(|_| json!({}));
    state::update_state(station_state, output_value, sat_key);

    Ok(output)
}

/// 星下点轨迹业务编排：解析参数 → clamp 校验 → 计算 → 返回响应（不更新 state）。
pub async fn compute_groundtrack_service(params: Value) -> Result<GroundTrackResponse, ApiError> {
    let (lat, lon, alt, label) = resolve_station(&params);
    let hours = clamp(num(&params, "hours", 48.0), 1.0, MAX_HOURS as f64) as i64;
    let step_sec = clamp(
        num(&params, "step_sec", 60.0),
        MIN_STEP_SEC as f64,
        MAX_STEP_SEC as f64,
    ) as i64;

    let (_sat_key, norad_id) = tle::resolve_satellite(&params);
    let (tle_name, tle1, tle2) = tle::get_tle_cached(norad_id)
        .await
        .map_err(|e| internal_err("获取 TLE 失败", e))?;

    let c_name = tle_name.clone();
    let c_l1 = tle1.clone();
    let c_l2 = tle2.clone();
    let points = tokio::task::spawn_blocking(move || {
        astro::compute_groundtrack(&c_name, &c_l1, &c_l2, lat, lon, alt, hours, step_sec)
    })
    .await
    .map_err(|e| internal_err("计算任务失败", e.to_string()))?
    .map_err(|e| internal_err("轨迹计算失败", e))?;

    let epoch = tle::parse_tle_epoch(&tle1)
        .map(|d| iso_utc(&d))
        .unwrap_or_default();

    Ok(GroundTrackResponse {
        satellite_name: tle_name,
        norad_id,
        tle_epoch: epoch,
        tle_source: tle::tle_source(norad_id),
        station_label: label,
        station_lat: astro::round(lat, 6),
        station_lon: astro::round(lon, 6),
        station_alt_m: astro::round(alt, 2),
        generated_at: iso_utc(&Utc::now()),
        hours,
        step_sec,
        points,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn station_preset_on80dd() {
        let (lat, lon, _alt, label) = resolve_station(&json!({ "preset": "on80dd" }));
        assert_eq!(label, "ON80DD");
        assert!((lat - 40.1458).abs() < 1e-6);
        assert!((lon - 116.2917).abs() < 1e-6);
    }

    #[test]
    fn station_preset_beijing_alias() {
        let (_lat, _lon, _alt, label) = resolve_station(&json!({ "preset": "BJ" }));
        assert_eq!(label, "Beijing");
    }

    #[test]
    fn station_clamp_and_label() {
        let (lat, lon, _alt, label) = resolve_station(&json!({ "lat": 999.0, "lon": -999.0 }));
        assert_eq!(lat, 90.0);
        assert_eq!(lon, -180.0);
        assert_eq!(label, "90.000, -180.000");
    }
}
