//! 类型化响应模型：对应 backend/models.py 与 astro.py 的 dataclass。
//!
//! 字段名与顺序严格对齐 FastAPI 的 response_model 序列化结果，避免破坏前端解析。
//! （注意 PassesResponse 中 tle_source 位于 passes 之前，与 pydantic 模型一致。）
//!
//! 设置 / Socket.IO 载荷等动态结构在各模块用 serde_json::Value 表示，
//! 以忠实复刻 Python 的"按键合并"字典行为。

use serde::Serialize;

/// 过境逐样本：方位/俯仰/斜距。
#[derive(Debug, Clone, Serialize)]
pub struct AzElSample {
    pub t: String,
    pub az: f64,
    pub el: f64,
    pub r_km: f64,
}

/// 单次过境。
#[derive(Debug, Clone, Serialize)]
pub struct Pass {
    pub index: i64,
    pub aos: String,
    pub los: String,
    pub duration_sec: i64,
    pub max_elevation_deg: f64,
    pub max_elevation_at: String,
    pub aos_az: f64,
    pub los_az: f64,
    pub peak_az: f64,
    pub samples: Vec<AzElSample>,
}

/// /api/passes 响应。
#[derive(Debug, Clone, Serialize)]
pub struct PassesResponse {
    pub satellite_name: String,
    pub norad_id: i64,
    pub tle_name: String,
    pub tle1: String,
    pub tle2: String,
    pub tle_epoch: String,
    pub station_lat: f64,
    pub station_lon: f64,
    pub station_alt_m: f64,
    pub station_label: String,
    pub generated_at: String,
    pub horizon_deg: f64,
    pub hours: i64,
    pub sample_interval_sec: i64,
    pub tle_source: String,
    pub passes: Vec<Pass>,
}

/// 星下点轨迹单点。
#[derive(Debug, Clone, Serialize)]
pub struct GroundTrackPoint {
    pub t: String,
    pub lat: f64,
    pub lon: f64,
    pub el: f64,
    pub az: f64,
    pub r_km: f64,
    pub orbit: i64,
    pub alt_km: f64,
}

/// /api/groundtrack 响应。
#[derive(Debug, Clone, Serialize)]
pub struct GroundTrackResponse {
    pub satellite_name: String,
    pub norad_id: i64,
    pub tle_epoch: String,
    pub tle_source: String,
    pub station_label: String,
    pub station_lat: f64,
    pub station_lon: f64,
    pub station_alt_m: f64,
    pub generated_at: String,
    pub hours: i64,
    pub step_sec: i64,
    pub points: Vec<GroundTrackPoint>,
}
