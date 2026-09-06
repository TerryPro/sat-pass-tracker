//! 过境计算 REST 接口：对应 backend/passesapi.py。
//!
//! 路由层只负责 HTTP 参数绑定与默认值（与 FastAPI 路由签名一致），
//! 业务编排（解析/校验/计算/状态更新）收敛到 passservice。

use axum::Json;
use axum::extract::Query;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::config;
use crate::error::ApiError;
use crate::models::{GroundTrackResponse, PassesResponse};
use crate::passservice;

/// /api/passes 查询参数（默认值对齐 passesapi.api_passes）。
#[derive(Debug, Deserialize)]
pub struct PassesQuery {
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub alt: Option<f64>,
    pub hours: Option<i64>,
    pub sample_interval: Option<i64>,
    pub horizon: Option<f64>,
    pub preset: Option<String>,
    pub satellite: Option<String>,
}

/// /api/groundtrack 查询参数（默认值对齐 passesapi.api_groundtrack）。
#[derive(Debug, Deserialize)]
pub struct GroundTrackQuery {
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub alt: Option<f64>,
    pub hours: Option<i64>,
    pub step_sec: Option<i64>,
    pub preset: Option<String>,
    pub satellite: Option<String>,
}

/// GET /api/passes：计算未来 N 小时指定卫星过境数据。
pub async fn passes(Query(q): Query<PassesQuery>) -> Result<Json<PassesResponse>, ApiError> {
    let params: Value = json!({
        "lat": q.lat.unwrap_or(*config::DEFAULT_LAT),
        "lon": q.lon.unwrap_or(*config::DEFAULT_LON),
        "alt": q.alt.unwrap_or(*config::DEFAULT_ALT_M),
        "hours": q.hours.unwrap_or(48),
        "sample_interval": q.sample_interval.unwrap_or(60),
        "horizon": q.horizon.unwrap_or(0.0),
        "preset": q.preset.unwrap_or_default(),
        "satellite": q.satellite.unwrap_or_else(|| "iss".to_string()),
    });
    Ok(Json(passservice::compute_passes_service(params).await?))
}

/// GET /api/groundtrack：计算星下点轨迹。
pub async fn groundtrack(
    Query(q): Query<GroundTrackQuery>,
) -> Result<Json<GroundTrackResponse>, ApiError> {
    let params: Value = json!({
        "lat": q.lat.unwrap_or(*config::DEFAULT_LAT),
        "lon": q.lon.unwrap_or(*config::DEFAULT_LON),
        "alt": q.alt.unwrap_or(*config::DEFAULT_ALT_M),
        "hours": q.hours.unwrap_or(48),
        "step_sec": q.step_sec.unwrap_or(60),
        "preset": q.preset.unwrap_or_default(),
        "satellite": q.satellite.unwrap_or_else(|| "iss".to_string()),
    });
    Ok(Json(passservice::compute_groundtrack_service(params).await?))
}
