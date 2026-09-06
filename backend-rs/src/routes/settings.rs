//! 用户设置 REST 接口：对应 backend/settings.py。

use axum::Json;
use serde_json::Value;

use crate::store;

/// GET /api/settings：读取持久化用户设置。
pub async fn get_settings() -> Json<Value> {
    Json(store::load_settings())
}

/// POST /api/settings：保存用户设置（按键合并），返回合并后的完整设置。
pub async fn save_settings(Json(payload): Json<Value>) -> Json<Value> {
    Json(store::save_settings(&payload))
}
